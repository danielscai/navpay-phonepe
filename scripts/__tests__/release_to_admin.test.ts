import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runReleaseCli } from "../release_to_admin";

test("uses local env by default and skips duplicate active release", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "release-to-admin-test-"));
  const apkPath = path.join(tempDir, "patched_signed.apk");
  writeFileSync(apkPath, Buffer.from("apk-bytes"));

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
