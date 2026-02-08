export type PersonalChannelSimPlan = {
  devices: Array<{ name: string }>;
  apps: Array<{ name: string; packageName: string; versionCode: number; downloadUrl: string; promoted: boolean }>;
  installs: Array<{ deviceIndex: number; appIndex: number }>;
  bankAccounts: Array<{ bankName: string; alias: string; accountLast4: string; ifsc?: string }>;
  transactions: Array<{ accountIndex: number; direction: "IN" | "OUT"; amount: string; ref: string; detailsJson: string; createdAtMs: number }>;
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function buildPersonalChannelInitialPlan(opts: { nowMs: number; personLabel: string }): PersonalChannelSimPlan {
  // Deterministic, human-readable plan: 2 devices x 2 apps = 4 installs.
  const devices = [
    { name: `${opts.personLabel}-Phone-A` },
    { name: `${opts.personLabel}-Phone-B` },
  ];

  const apps = [
    { name: "NetBank Alpha", packageName: "com.navpay.netbank.alpha", versionCode: 12, downloadUrl: "https://example.invalid/alpha.apk", promoted: true },
    { name: "NetBank Beta", packageName: "com.navpay.netbank.beta", versionCode: 7, downloadUrl: "https://example.invalid/beta.apk", promoted: false },
  ];

  const installs = [
    { deviceIndex: 0, appIndex: 0 },
    { deviceIndex: 0, appIndex: 1 },
    { deviceIndex: 1, appIndex: 0 },
    { deviceIndex: 1, appIndex: 1 },
  ];

  const bankAccounts = [
    { bankName: "HDFC", alias: `${opts.personLabel}-主账户`, accountLast4: "1234", ifsc: "HDFC0000123" },
  ];

  const d = new Date(opts.nowMs);
  const refBase = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const transactions = [
    {
      accountIndex: 0,
      direction: "IN" as const,
      amount: "100.00",
      ref: `SIM-${refBase}-IN-1`,
      detailsJson: JSON.stringify({ source: "sim", note: "初始入账" }),
      createdAtMs: opts.nowMs,
    },
    {
      accountIndex: 0,
      direction: "OUT" as const,
      amount: "20.00",
      ref: `SIM-${refBase}-OUT-1`,
      detailsJson: JSON.stringify({ source: "sim", note: "测试出账" }),
      createdAtMs: opts.nowMs + 60_000,
    },
  ];

  return { devices, apps, installs, bankAccounts, transactions };
}

