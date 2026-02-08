"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";

type Settings = { timezone: string };
type Me = {
  user: { id: string; username: string; displayName: string };
  perms: string[];
  debugToolsEnabled: boolean;
};

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

function hasPerm(perms: string[] | undefined | null, key: string): boolean {
  const p = perms ?? [];
  return p.includes("admin.all") || p.includes(key);
}

function tzLabel(tz: string): string {
  if (tz === "Asia/Kolkata") return "印度 (Asia/Kolkata)";
  return "中国 (Asia/Shanghai)";
}

function tzFlag(tz: string): string {
  // User explicitly requested flags for timezone switching.
  if (tz === "Asia/Kolkata") return "🇮🇳";
  return "🇨🇳";
}

const NAV_MAIN = [
  { href: "/admin", label: "仪表盘" },
  { href: "/admin/merchants", label: "商户管理" },
  { href: "/admin/orders/collect", label: "代收订单" },
  { href: "/admin/orders/payout", label: "代付订单" },
  { href: "/admin/payout/channels", label: "支付渠道" },
];

const NAV_SYSTEM = [
  { href: "/admin/system/config", label: "系统参数" },
  { href: "/admin/system/ip-whitelist", label: "IP 白名单" },
  { href: "/admin/callbacks", label: "通知队列" },
  { href: "/admin/resources", label: "资源管理" },
  { href: "/admin/audit-logs", label: "操作日志" },
  { href: "/admin/account", label: "个人设置" },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [settings, setSettings] = useState<Settings>({ timezone: "Asia/Shanghai" });
  const [me, setMe] = useState<Me | null>(null);
  const [tzOpen, setTzOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setSettings({ timezone: j.timezone });
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/admin/me");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) setMe(j as Me);
    })();
  }, []);

  async function setTimezone(timezone: string) {
    const h = await csrfHeader();
    await fetch("/api/settings/timezone", {
      method: "POST",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify({ timezone }),
    });
    // Settings are cookie-backed (httpOnly), so do a hard reload to re-sync.
    window.location.reload();
  }

  const showTools = !!me?.debugToolsEnabled && hasPerm(me?.perms, "tools.debug");

  const activeLabel = (() => {
    if (pathname.startsWith("/admin/tools")) return "调试工具";
    if (pathname.startsWith("/admin/account")) return "个人设置";
    if (pathname.startsWith("/admin/payout/payment-persons")) return "渠道详情";
    return (
      NAV_MAIN.concat(NAV_SYSTEM)
        .sort((a, b) => b.href.length - a.href.length)
        .find((n) => pathname === n.href || (n.href !== "/admin" && pathname.startsWith(n.href)))?.label ?? "仪表盘"
    );
  })();

  return (
    <div className="min-h-screen">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-8 md:grid-cols-[240px_1fr]">
        <aside className="np-card p-4 md:sticky md:top-8 md:h-[calc(100vh-4rem)] md:overflow-auto">
          <div>
            <div className="text-xs text-[var(--np-faint)]">NavPay</div>
            <div className="text-sm font-semibold tracking-tight">管理后台</div>
          </div>

          <div className="mt-4 text-xs text-[var(--np-faint)]">导航</div>
          <div className="mt-2 flex flex-col gap-1">
            {NAV_MAIN.map((n) => {
              const active = pathname === n.href || (n.href !== "/admin" && pathname.startsWith(n.href));
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={[
                    "rounded-xl px-3 py-2 text-sm transition-colors",
                    active ? "bg-white/10" : "hover:bg-white/5",
                  ].join(" ")}
                >
                  {n.label}
                </Link>
              );
            })}
          </div>

          <div className="mt-6 text-xs text-[var(--np-faint)]">系统</div>
          <div className="mt-2 flex flex-col gap-1">
            {NAV_SYSTEM.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={[
                    "rounded-xl px-3 py-2 text-sm transition-colors",
                    active ? "bg-white/10" : "hover:bg-white/5",
                  ].join(" ")}
                >
                  {n.label}
                </Link>
              );
            })}
          </div>

          {showTools ? (
            <>
              <div className="mt-6 text-xs text-[var(--np-faint)]">调试工具</div>
              <div className="mt-2 flex flex-col gap-1">
                <Link
                  href="/admin/tools"
                  className={[
                    "rounded-xl px-3 py-2 text-sm transition-colors",
                    pathname.startsWith("/admin/tools") ? "bg-white/10" : "hover:bg-white/5",
                  ].join(" ")}
                >
                  调试入口
                </Link>
              </div>
            </>
          ) : null}

          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-[var(--np-muted)]">
            V1: SQLite
            <div className="mt-1 text-[var(--np-faint)]">未来: Postgres</div>
          </div>
        </aside>

        <main className="np-card p-6">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="min-w-0">
              <div className="truncate text-xl font-semibold tracking-tight md:text-2xl">{activeLabel}</div>
            </div>

            <div className="flex items-center gap-2">
              {tzOpen || userOpen ? (
                <button
                  className="fixed inset-0 z-10 cursor-default bg-transparent"
                  aria-label="close-menus"
                  onClick={() => {
                    setTzOpen(false);
                    setUserOpen(false);
                  }}
                />
                ) : null}
              <div className="relative">
                <button
                  className="np-btn flex items-center gap-2 px-3 py-2 text-sm"
                  onClick={() => {
                    setTzOpen((v) => !v);
                    setUserOpen(false);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={tzOpen}
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    {tzFlag(settings.timezone)}
                  </span>
                  <span className="text-[var(--np-faint)]">时区</span>
                  <span className="text-[var(--np-text)]">{settings.timezone === "Asia/Kolkata" ? "印度" : "中国"}</span>
                  <span className="text-[10px] text-[var(--np-faint)]">▼</span>
                </button>
                {tzOpen ? (
                  <div
                    className="absolute right-0 z-20 mt-2 w-[220px] overflow-hidden rounded-xl border border-white/10 bg-[var(--np-surface)] shadow-lg"
                    role="menu"
                  >
                    <button
                      className={[
                        "w-full px-3 py-3 text-left text-sm transition-colors",
                        settings.timezone === "Asia/Shanghai" ? "bg-white/10" : "hover:bg-white/5",
                      ].join(" ")}
                      onClick={() => {
                        setTzOpen(false);
                        setTimezone("Asia/Shanghai");
                      }}
                      role="menuitem"
                    >
                      <span className="mr-2">🇨🇳</span>中国 (Asia/Shanghai)
                    </button>
                    <button
                      className={[
                        "w-full px-3 py-3 text-left text-sm transition-colors",
                        settings.timezone === "Asia/Kolkata" ? "bg-white/10" : "hover:bg-white/5",
                      ].join(" ")}
                      onClick={() => {
                        setTzOpen(false);
                        setTimezone("Asia/Kolkata");
                      }}
                      role="menuitem"
                    >
                      <span className="mr-2">🇮🇳</span>印度 (Asia/Kolkata)
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  className="np-btn w-[150px] px-3 py-2 text-sm text-right"
                  data-testid="user-menu"
                  onClick={() => {
                    setUserOpen((v) => !v);
                    setTzOpen(false);
                  }}
                  aria-haspopup="menu"
                  aria-expanded={userOpen}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-left">
                      {me ? `${me.user.displayName} (${me.user.username})` : "加载中..."}
                    </span>
                    <span className="text-[10px] text-[var(--np-faint)]">▼</span>
                  </span>
                </button>
                {userOpen ? (
                  <div
                    className="absolute right-0 z-20 mt-2 w-[150px] overflow-hidden rounded-xl border border-white/10 bg-[var(--np-surface)] shadow-lg"
                    role="menu"
                  >
                    <Link
                      href="/admin/account"
                      className="block w-full px-3 py-3 text-left text-sm transition-colors hover:bg-white/5"
                      onClick={() => setUserOpen(false)}
                    >
                      个人设置
                    </Link>
                    <button
                      data-testid="user-logout"
                      className="w-full px-3 py-3 text-left text-sm transition-colors hover:bg-white/5"
                      onClick={() => {
                        setUserOpen(false);
                        signOut({ callbackUrl: "/" });
                      }}
                      role="menuitem"
                    >
                      退出登录
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="pt-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
