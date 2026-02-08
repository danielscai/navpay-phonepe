"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";

type Merchant = { id: string; code: string; name: string; balance: string; payoutFrozen: string };
type Me = {
  uid: string;
  user: { id: string; username: string; displayName: string };
  merchant: Merchant | null;
};

type Settings = { timezone: string };

async function csrfHeader(): Promise<Record<string, string>> {
  const r = await fetch("/api/csrf");
  const j = await r.json().catch(() => null);
  const token = j?.token as string | undefined;
  return token ? { "x-csrf-token": token } : {};
}

const NAV = [
  { href: "/merchant", label: "概览" },
  { href: "/merchant/orders/collect", label: "代收订单" },
  { href: "/merchant/orders/payout", label: "代付订单" },
  { href: "/merchant/api", label: "API Key/限额" },
  { href: "/merchant/security/ip-whitelist", label: "IP 白名单" },
  { href: "/merchant/audit-logs", label: "操作日志" },
  { href: "/merchant/account", label: "个人设置" },
];

function tzLabel(tz: string): string {
  if (tz === "Asia/Kolkata") return "印度 (Asia/Kolkata)";
  return "中国 (Asia/Shanghai)";
}

function tzFlag(tz: string): string {
  // Keep consistent with AdminShell.
  if (tz === "Asia/Kolkata") return "🇮🇳";
  return "🇨🇳";
}

export default function MerchantShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [settings, setSettings] = useState<Settings>({ timezone: "Asia/Shanghai" });
  const [tzOpen, setTzOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/merchant/me");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok) setMe(j as Me);
    })();
    (async () => {
      const r = await fetch("/api/settings");
      const j = await r.json().catch(() => null);
      if (r.ok && j?.ok && typeof j?.timezone === "string") setSettings({ timezone: j.timezone });
    })();
  }, []);

  async function setTimezone(timezone: string) {
    const h = await csrfHeader();
    await fetch("/api/settings/timezone", {
      method: "POST",
      headers: { "content-type": "application/json", ...h },
      body: JSON.stringify({ timezone }),
    });
    window.location.reload();
  }

  const activeLabel = useMemo(() => {
    return (
      NAV.slice()
        .sort((a, b) => b.href.length - a.href.length)
        .find((n) => pathname === n.href || (n.href !== "/merchant" && pathname.startsWith(n.href)))?.label ?? "概览"
    );
  }, [pathname]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 px-6 py-8 md:grid-cols-[260px_1fr]">
        <aside className="np-card p-4 md:sticky md:top-8 md:h-[calc(100vh-4rem)] md:overflow-auto">
          <div>
            <div className="text-xs text-[var(--np-faint)]">NavPay</div>
            <div className="text-sm font-semibold tracking-tight">商户后台</div>
          </div>

          <div className="mt-4 text-xs text-[var(--np-faint)]">导航</div>
          <div className="mt-2 flex flex-col gap-1">
            {NAV.map((n) => {
              const active = pathname === n.href || (n.href !== "/merchant" && pathname.startsWith(n.href));
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

          <div className="mt-6 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-[var(--np-muted)]">
            文档: <Link className="underline decoration-white/20 hover:decoration-white/40" href="/docs/merchant-api">Merchant API</Link>
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
                      <span className="mr-2">🇨🇳</span>{tzLabel("Asia/Shanghai")}
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
                      <span className="mr-2">🇮🇳</span>{tzLabel("Asia/Kolkata")}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="relative">
                <button
                  className="np-btn w-[200px] px-3 py-2 text-sm text-right"
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
                      {me?.user ? `${me.user.displayName} (${me.user.username})` : "加载中..."}
                    </span>
                    <span className="text-[10px] text-[var(--np-faint)]">▼</span>
                  </span>
                </button>
                {userOpen ? (
                  <div
                    className="absolute right-0 z-20 mt-2 w-[200px] overflow-hidden rounded-xl border border-white/10 bg-[var(--np-surface)] shadow-lg"
                    role="menu"
                  >
                    <Link
                      href="/merchant/account"
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
