import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen px-6 py-10">
      <div className="mx-auto max-w-5xl">
        <div className="np-card p-8">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="np-badge">
                <span className="h-2 w-2 rounded-full bg-[var(--np-accent)]" />
                <span className="text-[var(--np-muted)]">NavPay Backoffice</span>
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight">
                NavPay 管理后台
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--np-muted)]">
                V1 目标：登录与 2FA、商户与订单、通知队列、系统配置、外部请求模拟、报表，以及可复测的自动化测试。
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <Link className="np-btn np-btn-primary text-center" href="/auth/login">
                登录
              </Link>
              <Link className="np-btn text-center" href="/webhook-simulator">
                Webhook 模拟器
              </Link>
            </div>
          </div>

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            <div className="np-card p-5">
              <div className="text-xs text-[var(--np-faint)]">核心链路</div>
              <div className="mt-2 text-sm text-[var(--np-muted)]">
                商户配置 → 代收/代付订单 → 状态流转 → 回调队列 → 统计报表
              </div>
            </div>
            <div className="np-card p-5">
              <div className="text-xs text-[var(--np-faint)]">安全</div>
              <div className="mt-2 text-sm text-[var(--np-muted)]">
                强密码策略、登录限速/锁定、CSRF、防护头、Google Authenticator 2FA
              </div>
            </div>
            <div className="np-card p-5">
              <div className="text-xs text-[var(--np-faint)]">可测试性</div>
              <div className="mt-2 text-sm text-[var(--np-muted)]">
                场景驱动用例 + Playwright E2E + Vitest 单测 + 可生成测试报告
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 text-xs text-[var(--np-faint)]">
          SQLite (V1) → 未来迁移 Postgres：数据类型与迁移策略会在文档中给出。
        </div>
      </div>
    </div>
  );
}

