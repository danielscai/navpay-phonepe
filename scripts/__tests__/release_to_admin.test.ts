import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runReleaseCli } from "../release_to_admin";

test("uses local env by default and skips duplicate active release", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "release-to-admin-test-"));
  const apkPath = path.join(tempDir, "patched_signed.apk");
  const abiApkPath = path.join(tempDir, "split_config.arm64_v8a.apk");
  const densityApkPath = path.join(tempDir, "split_config.xxhdpi.apk");
  writeFileSync(apkPath, Buffer.from("apk-bytes"));
  writeFileSync(abiApkPath, Buffer.from("abi-bytes"));
  writeFileSync(densityApkPath, Buffer.from("density-bytes"));

  try {
    const fakeApi = {
      getActiveRelease: async () => ({ id: "par_active", versionCode: 100, baseSha256: "sha_same" }),
      createRelease: async () => ({ id: "par_new" }),
      uploadArtifact: async () => ({ ok: true }),
      activateRelease: async () => ({ status: "active" }),
    };

    const out = await runReleaseCli(["--apk", apkPath], fakeApi as any, {
      readApkMetadata: async () => ({
        versionName: "1.0.0",
        versionCode: 100,
        packageName: "com.phonepe.app",
        minSdk: 24,
        targetSdk: 35,
      }),
      sha256File: async () => "sha_same",
    });

    assert.equal(out.targetEnv, "local");
    assert.equal(out.idempotent, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("uploads explicit base/abi/density artifacts and applies metadata overrides", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "release-to-admin-test-"));
  const baseApkPath = path.join(tempDir, "base.apk");
  const abiApkPath = path.join(tempDir, "split_config.arm64_v8a.apk");
  const densityApkPath = path.join(tempDir, "split_config.xxhdpi.apk");
  writeFileSync(baseApkPath, Buffer.from("base-bytes"));
  writeFileSync(abiApkPath, Buffer.from("abi-bytes"));
  writeFileSync(densityApkPath, Buffer.from("density-bytes"));

  const uploadCalls: Array<{ artifactType: string; name: string; apkPath: string }> = [];
  let createPayload: any = null;

  try {
    const fakeApi = {
      getActiveRelease: async () => null,
      createRelease: async (_appId: string, payload: any) => {
        createPayload = payload;
        return { id: "par_new" };
      },
      uploadArtifact: async (_appId: string, _releaseId: string, artifactType: "base" | "abi" | "density", name: string, apkPath: string) => {
        uploadCalls.push({ artifactType, name, apkPath });
      },
      activateRelease: async () => ({ status: "active" }),
    };

    const out = await runReleaseCli(
      [
        "--apk",
        baseApkPath,
        "--abi-apk",
        abiApkPath,
        "--density-apk",
        densityApkPath,
        "--version-name",
        "26.01.02.2",
        "--version-code",
        "26010207",
        "--installer-min-version",
        "3",
      ],
      fakeApi as any,
      {
        readApkMetadata: async () => ({
          versionName: "from-aapt",
          versionCode: 26010206,
          packageName: "com.phonepe.app",
          minSdk: 24,
          targetSdk: 35,
          installerMinVersion: 1,
        }),
        sha256File: async () => "sha_base",
      },
    );

    assert.equal(out.ok, true);
    assert.equal(out.idempotent, false);
    assert.equal(out.releaseId, "par_new");
    assert.equal(createPayload.versionName, "26.01.02.2");
    assert.equal(createPayload.versionCode, 26010207);
    assert.equal(createPayload.installerMinVersion, 3);
    assert.deepEqual(uploadCalls, [
      { artifactType: "base", name: "base.apk", apkPath: baseApkPath },
      { artifactType: "abi", name: "split_config.arm64_v8a.apk", apkPath: abiApkPath },
      { artifactType: "density", name: "split_config.xxhdpi.apk", apkPath: densityApkPath },
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("supports independent artifact paths when only --base-apk is provided", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "release-to-admin-test-"));
  const baseApkPath = path.join(tempDir, "patched_signed.apk");
  const abiApkPath = path.join(tempDir, "splits", "split_config.arm64_v8a.apk");
  const densityApkPath = path.join(tempDir, "splits", "split_config.xxhdpi.apk");
  const splitsDir = path.dirname(abiApkPath);
  require("node:fs").mkdirSync(splitsDir, { recursive: true });
  writeFileSync(baseApkPath, Buffer.from("base-bytes"));
  writeFileSync(abiApkPath, Buffer.from("abi-bytes"));
  writeFileSync(densityApkPath, Buffer.from("density-bytes"));

  const uploadCalls: Array<{ artifactType: string; apkPath: string }> = [];

  try {
    const fakeApi = {
      getActiveRelease: async () => null,
      createRelease: async () => ({ id: "par_new" }),
      uploadArtifact: async (_appId: string, _releaseId: string, artifactType: "base" | "abi" | "density", _name: string, apkPath: string) => {
        uploadCalls.push({ artifactType, apkPath });
      },
      activateRelease: async () => ({ status: "active" }),
    };

    const out = await runReleaseCli(
      [
        "--base-apk",
        baseApkPath,
        "--abi-apk",
        abiApkPath,
        "--density-apk",
        densityApkPath,
      ],
      fakeApi as any,
      {
        readApkMetadata: async () => ({
          versionName: "26.01.02.3",
          versionCode: 26010208,
          packageName: "com.phonepe.app",
          minSdk: 24,
          targetSdk: 35,
          installerMinVersion: 3,
        }),
        sha256File: async () => "sha_base",
      },
    );

    assert.equal(out.ok, true);
    assert.deepEqual(uploadCalls, [
      { artifactType: "base", apkPath: baseApkPath },
      { artifactType: "abi", apkPath: abiApkPath },
      { artifactType: "density", apkPath: densityApkPath },
    ]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
