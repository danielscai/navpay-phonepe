import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type StepResult = {
  name: string;
  cmd: string;
  code: number;
  durationMs: number;
  stdout: string;
  stderr: string;
};

function runStep(name: string, cmd: string, args: string[], envExtra?: Record<string, string>): StepResult {
  const start = Date.now();
  const r = spawnSync(cmd, args, {
    env: { ...process.env, ...(envExtra ?? {}) },
    encoding: "utf8",
  });
  const end = Date.now();
  return {
    name,
    cmd: `${cmd} ${args.join(" ")}`.trim(),
    code: r.status ?? 1,
    durationMs: end - start,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

function fmtMs(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s - m * 60);
  return `${m}m${rs}s`;
}

function nowYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function writeFileSafe(p: string, s: string) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, "utf8");
}

function main() {
  const ymd = nowYmd();
  const root = process.cwd();
  const logsDir = path.join(root, "test-results");
  const logPath = path.join(logsDir, `test-report-${ymd}.log`);

  const steps: StepResult[] = [];

  // Keep env stable and avoid NextAuth warnings in test web server.
  const envExtra = {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || "http://127.0.0.1:3100",
    APP_BASE_URL: process.env.APP_BASE_URL || process.env.NEXTAUTH_URL || "http://127.0.0.1:3100",
    ENABLE_DEBUG_TOOLS: process.env.ENABLE_DEBUG_TOOLS || "1",
  };

  steps.push(runStep("build", "yarn", ["build"], envExtra));
  steps.push(runStep("unit", "yarn", ["test"], envExtra));
  steps.push(runStep("e2e", "yarn", ["test:e2e"], envExtra));

  const ok = steps.every((s) => s.code === 0);

  const log = steps
    .map((s) => {
      return [
        `# ${s.name}`,
        `cmd: ${s.cmd}`,
        `code: ${s.code}`,
        `duration: ${fmtMs(s.durationMs)}`,
        "",
        "## stdout",
        s.stdout.trim() || "(empty)",
        "",
        "## stderr",
        s.stderr.trim() || "(empty)",
        "",
      ].join("\n");
    })
    .join("\n");

  writeFileSafe(logPath, log);

  const reportMd = [
    "# NavPay 管理后台 测试报告 (V1)",
    "",
    `生成日期：${ymd}`,
    "",
    "## 环境",
    `- Node: ${process.version}`,
    "- Next.js: 16.1.6",
    "- DB: SQLite（E2E 使用 `data/test.db`，运行前会重建）",
    "",
    "## 执行命令",
    "```bash",
    "cd navpay-admin",
    "yarn test:report",
    "```",
    "",
    "## 结果摘要",
    ...steps.map((s) => `- ${s.name}: ${s.code === 0 ? "通过" : `失败(code=${s.code})`}（${fmtMs(s.durationMs)}）`),
    "",
    "## 覆盖场景",
    "- 强制 2FA 首次登录与绑定（Google Authenticator TOTP）",
    "- Passkey(WebAuthn) 绑定与登录（虚拟验证器自动化）",
    "- 渠道账户邀请码上下级 + 今日收益(India) + 多级返利（代收 SUCCESS 实时结算）",
    "- 创建 Webhook 接收器并获取接收 URL",
    "- 在「调试工具 -> 订单模拟器」创建代收订单、推进状态为 SUCCESS、生成回调任务、执行回调 worker、Webhook 接收端收到 payload",
    "- 在「调试工具 -> 订单模拟器」创建代付订单、冻结余额、审核流转、生成回调任务、执行回调 worker、Webhook 接收端收到 payload",
    "",
    "## 产物",
    `- 详细日志：\`navpay-admin/test-results/test-report-${ymd}.log\``,
    "- 测试用例：`navpay-admin/docs/TESTCASES_V1.md`",
    "",
    ok ? "## 结论\n- 本次测试全通过。" : "## 结论\n- 本次测试存在失败，请查看日志定位。",
    "",
  ].join("\n");

  writeFileSafe(path.join(root, "docs", "TEST_REPORT_V1.md"), reportMd);

  if (!ok) process.exit(1);
}

main();
