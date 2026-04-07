import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

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
  versionName?: string;
  status?: string;
  baseSha256?: string | null;
};

type PublisherApi = {
  getActiveRelease: (appId: string) => Promise<ActiveRelease | null>;
  listReleases?: (appId: string) => Promise<ActiveRelease[]>;
  createRelease: (appId: string, payload: ApkMetadata) => Promise<{ id: string }>;
  uploadArtifact: (
    appId: string,
    releaseId: string,
    artifactType: "base" | "abi" | "density",
    name: string,
    apkPath: string,
    signingDigest: string,
  ) => Promise<void>;
  activateRelease: (appId: string, releaseId: string) => Promise<{ status: string }>;
};

type CliDeps = {
  readApkMetadata: (apkPath: string) => Promise<ApkMetadata>;
  sha256File: (apkPath: string) => Promise<string>;
  readApkSigningDigest: (apkPath: string) => Promise<string>;
  now: () => Date;
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

function normalizeDigest(raw: string): string {
  return raw.replace(/:/g, "").trim().toLowerCase();
}

function compareVersionDesc(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number(x));
  const pb = b.split(".").map((x) => Number(x));
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return db - da;
  }
  return 0;
}

function resolveApkSignerPath(): string {
  const fromEnv = String(process.env.APKSIGNER_PATH ?? "").trim();
  if (fromEnv) return fromEnv;

  const sdkRoot = String(process.env.ANDROID_SDK_ROOT ?? process.env.ANDROID_HOME ?? "").trim();
  const candidateRoots = [sdkRoot, "/Users/danielscai/Library/Android/sdk"].filter(Boolean);
  for (const root of candidateRoots) {
    const buildToolsDir = join(root, "build-tools");
    try {
      const versions = readdirSync(buildToolsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort(compareVersionDesc);
      for (const version of versions) {
        const candidate = join(buildToolsDir, version, "apksigner");
        if (existsSync(candidate)) return candidate;
      }
    } catch {
      continue;
    }
  }
  return "apksigner";
}

function readApkSigningDigestDefault(apkPath: string): string {
  const apksigner = resolveApkSignerPath();
  const out = execFileSync(apksigner, ["verify", "--print-certs", apkPath], { encoding: "utf8" });
  const match = out.match(/certificate SHA-256 digest:\s*([A-Fa-f0-9:\s]+)/);
  if (!match?.[1]) {
    throw new Error(`apk_signing_digest_parse_failed:${apkPath}`);
  }
  const digest = normalizeDigest(match[1]);
  if (!digest) {
    throw new Error(`apk_signing_digest_empty:${apkPath}`);
  }
  return digest;
}

function defaultDeps(): CliDeps {
  return {
    readApkMetadata: async (apkPath) => readApkMetadataDefault(apkPath),
    sha256File: sha256FileDefault,
    readApkSigningDigest: async (apkPath) => readApkSigningDigestDefault(apkPath),
    now: () => new Date(),
  };
}

function formatDateVersionPrefix(date: Date): string {
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}.${mm}.${dd}`;
}

function parseDateVersion(versionName?: string | null): { prefix: string; sequence: number } | null {
  if (!versionName) return null;
  const match = String(versionName).trim().match(/^(\d{2}\.\d{2}\.\d{2})\.(\d+)$/);
  if (!match) return null;
  return {
    prefix: match[1],
    sequence: Number(match[2]),
  };
}

function resolveNextDateVersionName(latestVersionName: string | null | undefined, now: Date): string {
  const todayPrefix = formatDateVersionPrefix(now);
  const parsedLatest = parseDateVersion(latestVersionName);
  if (!parsedLatest || parsedLatest.prefix !== todayPrefix) {
    return `${todayPrefix}.0`;
  }
  return `${todayPrefix}.${parsedLatest.sequence + 1}`;
}

function versionCodeFromDateVersionName(versionName: string): number | null {
  const parsed = parseDateVersion(versionName);
  if (!parsed) return null;
  const [yy, mm, dd] = parsed.prefix.split(".").map((part) => Number(part));
  return yy * 1_000_000 + mm * 10_000 + dd * 100 + parsed.sequence + 5;
}

function buildHttpApi(baseUrl: string, token: string): PublisherApi {
  const origin = baseUrl.replace(/\/$/, "");
  const authHeaders = { authorization: `Bearer ${token}` };
  const fetchRows = async (appId: string): Promise<any[]> => {
    const r = await fetch(`${origin}/api/publisher/payment-apps/${appId}/releases`, {
      method: "GET",
      headers: authHeaders,
    });
    if (!r.ok) throw new Error(`list_failed_${r.status}`);
    const j: any = await r.json();
    return Array.isArray(j?.rows) ? j.rows : [];
  };
  return {
    async listReleases(appId: string) {
      const rows = await fetchRows(appId);
      return rows.map((row: any) => ({
        id: String(row?.id ?? ""),
        versionCode: Number(row?.versionCode ?? 0),
        versionName: row?.versionName ? String(row.versionName) : undefined,
        status: row?.status ? String(row.status) : undefined,
        baseSha256: row?.baseSha256 ? String(row.baseSha256) : null,
      }));
    },
    async getActiveRelease(appId: string) {
      const rows = await fetchRows(appId);
      const active = rows.find((row: any) => row?.status === "active");
      if (!active) return null;
      return {
        id: String(active.id),
        versionCode: Number(active.versionCode),
        versionName: active.versionName ? String(active.versionName) : undefined,
        status: "active",
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
    async uploadArtifact(
      appId: string,
      releaseId: string,
      artifactType: "base" | "abi" | "density",
      name: string,
      apkPath: string,
      signingDigest: string,
    ) {
      const bytes = await readFile(apkPath);
      const file = new File([bytes], basename(apkPath), { type: "application/vnd.android.package-archive" });
      const form = new FormData();
      form.set("artifactType", artifactType);
      form.set("name", name);
      form.set("signingDigest", signingDigest);
      if (artifactType === "abi") form.set("abi", "arm64-v8a");
      if (artifactType === "density") form.set("density", "xxhdpi");
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
  const baseApkPath = String(args["base-apk"] ?? args.apk ?? "").trim();
  if (!baseApkPath) throw new Error("base_apk_required");
  const abiApkPath = String(args["abi-apk"] ?? join(dirname(baseApkPath), DEFAULT_ABI_SPLIT_NAME)).trim();
  const densityApkPath = String(args["density-apk"] ?? join(dirname(baseApkPath), DEFAULT_DENSITY_SPLIT_NAME)).trim();
  await stat(baseApkPath);
  await stat(abiApkPath);
  await stat(densityApkPath);

  const envName = String(args.env ?? "local").trim() || "local";
  const appIdFromArg = String(args.appId ?? "").trim();
  const appIdFromEnv = String(process.env.RELEASE_APP_ID ?? "").trim();
  const appId = appIdFromArg || appIdFromEnv || "phonepe";
  const appIdWasExplicit = Boolean(appIdFromArg || appIdFromEnv);
  const baseUrl = resolveBaseUrl(envName, args.baseUrl);
  const token = String(args.token ?? process.env.RELEASE_TOKEN ?? (envName === "local" ? LOCAL_DEFAULT_RELEASE_TOKEN : "")).trim();

  const useDeps = { ...defaultDeps(), ...deps };
  const useApi = (() => {
    if (api) return api;
    if (!token) throw new Error("release_token_required");
    return buildHttpApi(baseUrl, token);
  })();

  const signatureDigests = {
    base: await useDeps.readApkSigningDigest(baseApkPath),
    abi: await useDeps.readApkSigningDigest(abiApkPath),
    density: await useDeps.readApkSigningDigest(densityApkPath),
  };
  if (signatureDigests.base !== signatureDigests.abi || signatureDigests.base !== signatureDigests.density) {
    throw new Error(
      `apk_signatures_inconsistent base=${signatureDigests.base} abi=${signatureDigests.abi} density=${signatureDigests.density}`,
    );
  }

  const metadataFromApk = await useDeps.readApkMetadata(baseApkPath);
  const now = useDeps.now();
  const allReleases = useApi.listReleases ? await useApi.listReleases(appId) : null;
  const latestReleaseByVersionCode = allReleases
    ? allReleases.reduce<ActiveRelease | null>((acc, item) => {
        if (!acc) return item;
        return item.versionCode > acc.versionCode ? item : acc;
      }, null)
    : null;
  const active = allReleases ? allReleases.find((row) => row.status === "active") ?? null : await useApi.getActiveRelease(appId);
  const explicitVersionName = String(args["version-name"] ?? "").trim();
  const shouldAutoVersionName = Boolean(allReleases);
  const resolvedVersionName = explicitVersionName
    || (shouldAutoVersionName
      ? resolveNextDateVersionName(latestReleaseByVersionCode?.versionName ?? null, now)
      : metadataFromApk.versionName);
  const shouldInferVersionCode = Boolean(explicitVersionName || shouldAutoVersionName);
  const inferredVersionCode = shouldInferVersionCode ? versionCodeFromDateVersionName(resolvedVersionName) : null;
  const metadata: ApkMetadata = {
    ...metadataFromApk,
    versionName: resolvedVersionName,
    versionCode: Number(args["version-code"] ?? inferredVersionCode ?? metadataFromApk.versionCode),
    installerMinVersion: Number(args["installer-min-version"] ?? metadataFromApk.installerMinVersion),
  };
  const checksum = await useDeps.sha256File(baseApkPath);
  const sameVersion = active?.versionCode === metadata.versionCode;
  const sameChecksum = !active?.baseSha256 || active.baseSha256 === checksum;
  if (sameVersion && sameChecksum) {
    return { ok: true, targetEnv: envName, idempotent: true, releaseId: active?.id };
  }

  let release: { id: string };
  try {
    release = await useApi.createRelease(appId, metadata);
  } catch (error) {
    const message = (error as { message?: string })?.message ?? String(error);
    if (message === "create_failed_404" && !appIdWasExplicit) {
      throw new Error(
        "create_failed_404: default app reference `phonepe` not found. " +
          "This CLI publishes by stable app name; ensure navpay-admin payment app name `phonepe` exists and is enabled.",
      );
    }
    throw error;
  }
  await useApi.uploadArtifact(appId, release.id, "base", "base.apk", baseApkPath, signatureDigests.base);
  await useApi.uploadArtifact(appId, release.id, "abi", DEFAULT_ABI_SPLIT_NAME, abiApkPath, signatureDigests.abi);
  await useApi.uploadArtifact(appId, release.id, "density", DEFAULT_DENSITY_SPLIT_NAME, densityApkPath, signatureDigests.density);
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
