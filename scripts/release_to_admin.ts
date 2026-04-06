import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

type ApkMetadata = {
  versionName: string;
  versionCode: number;
  packageName: string;
  minSdk: number;
  targetSdk: number;
  installerMinVersion: number;
};

type ActiveRelease = {
  id: string;
  versionCode: number;
  baseSha256?: string | null;
};

type PublisherApi = {
  getActiveRelease: (appId: string) => Promise<ActiveRelease | null>;
  createRelease: (appId: string, payload: ApkMetadata) => Promise<{ id: string }>;
  uploadArtifact: (appId: string, releaseId: string, artifactType: "base" | "abi" | "density", name: string, apkPath: string) => Promise<void>;
  activateRelease: (appId: string, releaseId: string) => Promise<{ status: string }>;
};

type CliDeps = {
  readApkMetadata: (apkPath: string) => Promise<ApkMetadata>;
  sha256File: (apkPath: string) => Promise<string>;
};

type RunResult = {
  ok: boolean;
  targetEnv: string;
  idempotent: boolean;
  releaseId?: string;
};

const LOCAL_DEFAULT_RELEASE_TOKEN = "nprt_local_phonepe_publisher";
const DEFAULT_ABI_SPLIT_NAME = "split_config.arm64_v8a.apk";
const DEFAULT_DENSITY_SPLIT_NAME = "split_config.xxhdpi.apk";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i] ?? "";
    if (!raw.startsWith("--")) continue;
    const key = raw.slice(2);
    const val = argv[i + 1];
    if (!val || val.startsWith("--")) {
      out[key] = "true";
      continue;
    }
    out[key] = val;
    i += 1;
  }
  return out;
}

export function resolveBaseUrl(envName: string, override?: string): string {
  if (override?.trim()) return override.trim();
  if (envName === "local") return "http://localhost:3000";
  throw new Error("base_url_required_for_non_local");
}

async function sha256FileDefault(apkPath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(apkPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

function readApkMetadataDefault(apkPath: string): ApkMetadata {
  try {
    const out = execFileSync("aapt", ["dump", "badging", apkPath], { encoding: "utf8" });
    const pkg = out.match(/package:\s+name='([^']+)'/);
    const versionCode = out.match(/versionCode='(\d+)'/);
    const versionName = out.match(/versionName='([^']+)'/);
    const minSdk = out.match(/sdkVersion:'(\d+)'/);
    const targetSdk = out.match(/targetSdkVersion:'(\d+)'/);
    if (!pkg || !versionCode || !versionName || !minSdk || !targetSdk) {
      throw new Error("apk_metadata_parse_failed");
    }
    return {
      packageName: pkg[1],
      versionCode: Number(versionCode[1]),
      versionName: versionName[1],
      minSdk: Number(minSdk[1]),
      targetSdk: Number(targetSdk[1]),
      installerMinVersion: 1,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      packageName: String(process.env.RELEASE_PACKAGE_NAME ?? "com.phonepe.app"),
      versionCode: Number(process.env.RELEASE_VERSION_CODE ?? Math.floor(Date.now() / 1000)),
      versionName: String(process.env.RELEASE_VERSION_NAME ?? `auto-${Date.now()}`),
      minSdk: Number(process.env.RELEASE_MIN_SDK ?? 24),
      targetSdk: Number(process.env.RELEASE_TARGET_SDK ?? 35),
      installerMinVersion: 1,
    };
  }
}

function defaultDeps(): CliDeps {
  return {
    readApkMetadata: async (apkPath) => readApkMetadataDefault(apkPath),
    sha256File: sha256FileDefault,
  };
}

function buildHttpApi(baseUrl: string, token: string): PublisherApi {
  const origin = baseUrl.replace(/\/$/, "");
  const authHeaders = { authorization: `Bearer ${token}` };
  return {
    async getActiveRelease(appId: string) {
      const r = await fetch(`${origin}/api/publisher/payment-apps/${appId}/releases`, {
        method: "GET",
        headers: authHeaders,
      });
      if (!r.ok) throw new Error(`list_failed_${r.status}`);
      const j: any = await r.json();
      const rows = Array.isArray(j?.rows) ? j.rows : [];
      const active = rows.find((row: any) => row?.status === "active");
      if (!active) return null;
      return {
        id: String(active.id),
        versionCode: Number(active.versionCode),
        baseSha256: active.baseSha256 ? String(active.baseSha256) : null,
      };
    },
    async createRelease(appId: string, payload: ApkMetadata) {
      const r = await fetch(`${origin}/api/publisher/payment-apps/${appId}/releases`, {
        method: "POST",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`create_failed_${r.status}`);
      const j: any = await r.json();
      return { id: String(j?.row?.id) };
    },
    async uploadArtifact(appId: string, releaseId: string, artifactType: "base" | "abi" | "density", name: string, apkPath: string) {
      const bytes = await readFile(apkPath);
      const file = new File([bytes], basename(apkPath), { type: "application/vnd.android.package-archive" });
      const form = new FormData();
      form.set("artifactType", artifactType);
      form.set("name", name);
      form.set("file", file);
      const r = await fetch(`${origin}/api/publisher/payment-apps/${appId}/releases/${releaseId}/artifacts`, {
        method: "POST",
        headers: authHeaders,
        body: form,
      });
      if (!r.ok) throw new Error(`upload_failed_${r.status}`);
    },
    async activateRelease(appId: string, releaseId: string) {
      const r = await fetch(`${origin}/api/publisher/payment-apps/${appId}/releases/${releaseId}/activate`, {
        method: "POST",
        headers: authHeaders,
      });
      if (!r.ok) throw new Error(`activate_failed_${r.status}`);
      const j: any = await r.json();
      return { status: String(j?.row?.status ?? "") };
    },
  };
}

export async function runReleaseCli(
  argv: string[],
  api?: PublisherApi,
  deps?: Partial<CliDeps>,
): Promise<RunResult> {
  const args = parseArgs(argv);
  const apkPath = String(args.apk ?? "").trim();
  if (!apkPath) throw new Error("apk_required");
  await stat(apkPath);
  const baseApkPath = String(args["base-apk"] ?? apkPath).trim() || apkPath;
  const abiApkPath = String(args["abi-apk"] ?? join(dirname(baseApkPath), DEFAULT_ABI_SPLIT_NAME)).trim();
  const densityApkPath = String(args["density-apk"] ?? join(dirname(baseApkPath), DEFAULT_DENSITY_SPLIT_NAME)).trim();
  await stat(baseApkPath);
  await stat(abiApkPath);
  await stat(densityApkPath);

  const envName = String(args.env ?? "local").trim() || "local";
  const appId = String(args.appId ?? "phonepe").trim() || "phonepe";
  const baseUrl = resolveBaseUrl(envName, args.baseUrl);
  const token = String(args.token ?? process.env.RELEASE_TOKEN ?? (envName === "local" ? LOCAL_DEFAULT_RELEASE_TOKEN : "")).trim();

  const useDeps = { ...defaultDeps(), ...deps };
  const useApi = (() => {
    if (api) return api;
    if (!token) throw new Error("release_token_required");
    return buildHttpApi(baseUrl, token);
  })();

  const metadataFromApk = await useDeps.readApkMetadata(baseApkPath);
  const metadata: ApkMetadata = {
    ...metadataFromApk,
    versionName: String(args["version-name"] ?? metadataFromApk.versionName).trim() || metadataFromApk.versionName,
    versionCode: Number(args["version-code"] ?? metadataFromApk.versionCode),
    installerMinVersion: Number(args["installer-min-version"] ?? metadataFromApk.installerMinVersion),
  };
  const checksum = await useDeps.sha256File(baseApkPath);
  const active = await useApi.getActiveRelease(appId);
  const sameVersion = active?.versionCode === metadata.versionCode;
  const sameChecksum = !active?.baseSha256 || active.baseSha256 === checksum;
  if (sameVersion && sameChecksum) {
    return { ok: true, targetEnv: envName, idempotent: true, releaseId: active?.id };
  }

  const release = await useApi.createRelease(appId, metadata);
  await useApi.uploadArtifact(appId, release.id, "base", "base.apk", baseApkPath);
  await useApi.uploadArtifact(appId, release.id, "abi", DEFAULT_ABI_SPLIT_NAME, abiApkPath);
  await useApi.uploadArtifact(appId, release.id, "density", DEFAULT_DENSITY_SPLIT_NAME, densityApkPath);
  await useApi.activateRelease(appId, release.id);

  return { ok: true, targetEnv: envName, idempotent: false, releaseId: release.id };
}

async function main() {
  const out = await runReleaseCli(process.argv.slice(2));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out, null, 2));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1])) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exit(1);
  });
}
