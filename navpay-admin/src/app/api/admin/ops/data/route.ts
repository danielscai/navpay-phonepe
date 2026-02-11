import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { collectOrders, merchants, payoutOrders, paymentApps, rechargeOrders } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { and, eq, gte, isNotNull, lte, or, sql } from "drizzle-orm";

function ymdInTz(ms: number, tz: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return dtf.format(new Date(ms)); // YYYY-MM-DD
}

function startOfDayMsInTz(ymd: string, tz: string): number | null {
  // ymd: YYYY-MM-DD -> interpret as local day in tz, convert to UTC ms.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const guessUtc = Date.UTC(y, mo - 1, d, 0, 0, 0);
  // Compute offset using Intl parts trick.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(guessUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offset = asUtc - guessUtc;
  return guessUtc - offset;
}

const querySchema = z.object({
  tz: z.string().default("Asia/Shanghai"),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  groupBy: z.enum(["day", "merchant", "payment_app"]).default("day"),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "system.read");
  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    tz: u.searchParams.get("tz") ?? undefined,
    dateFrom: u.searchParams.get("dateFrom") ?? undefined,
    dateTo: u.searchParams.get("dateTo") ?? undefined,
    groupBy: u.searchParams.get("groupBy") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const tz = parsed.data.tz;
  const now = Date.now();
  const today = ymdInTz(now, tz);
  const dateFrom = parsed.data.dateFrom ?? today;
  const dateTo = parsed.data.dateTo ?? today;
  const startMs = startOfDayMsInTz(dateFrom, tz);
  const endMs0 = startOfDayMsInTz(dateTo, tz);
  if (startMs === null || endMs0 === null) return NextResponse.json({ ok: false, error: "bad_date" }, { status: 400 });
  const endMs = endMs0 + 24 * 60 * 60 * 1000;

  // Pull within range, bucket in JS (SQLite timezone bucketing is messy).
  const collect = await db
    .select({
      merchantId: collectOrders.merchantId,
      paymentAppId: collectOrders.paymentAppId,
      amount: collectOrders.amount,
      fee: collectOrders.fee,
      channelFee: collectOrders.channelFee,
      successAtMs: collectOrders.successAtMs,
    })
    .from(collectOrders)
    .where(and(eq(collectOrders.status, "SUCCESS"), isNotNull(collectOrders.successAtMs), gte(collectOrders.successAtMs, startMs), lte(collectOrders.successAtMs, endMs)));

  const payout = await db
    .select({
      merchantId: payoutOrders.merchantId,
      amount: payoutOrders.amount,
      fee: payoutOrders.fee,
      channelFee: payoutOrders.channelFee,
      successAtMs: payoutOrders.successAtMs,
    })
    .from(payoutOrders)
    .where(and(eq(payoutOrders.status, "SUCCESS"), isNotNull(payoutOrders.successAtMs), gte(payoutOrders.successAtMs, startMs), lte(payoutOrders.successAtMs, endMs)));

  const recharge = await db
    .select({
      merchantId: rechargeOrders.merchantId,
      amount: rechargeOrders.amount,
      creditedAtMs: rechargeOrders.creditedAtMs,
    })
    .from(rechargeOrders)
    .where(and(eq(rechargeOrders.status, "SUCCESS"), isNotNull(rechargeOrders.creditedAtMs), gte(rechargeOrders.creditedAtMs, startMs), lte(rechargeOrders.creditedAtMs, endMs)));

  const merchantRows = await db.select({ id: merchants.id, code: merchants.code, name: merchants.name }).from(merchants);
  const merchantById = new Map(merchantRows.map((m) => [m.id, m]));
  const appRows = await db.select({ id: paymentApps.id, name: paymentApps.name, packageName: paymentApps.packageName }).from(paymentApps);
  const appById = new Map(appRows.map((a) => [a.id, a]));

  type Agg = {
    key: string;
    label: string;
    collectSuccessCount: number;
    collectSuccessAmount: number;
    collectFee: number;
    collectChannelFee: number;
    payoutSuccessCount: number;
    payoutSuccessAmount: number;
    payoutFee: number;
    payoutChannelFee: number;
    rechargeSuccessAmount: number;
  };
  const byKey = new Map<string, Agg>();
  const ensure = (key: string, label: string): Agg => {
    const cur = byKey.get(key);
    if (cur) return cur;
    const a: Agg = {
      key,
      label,
      collectSuccessCount: 0,
      collectSuccessAmount: 0,
      collectFee: 0,
      collectChannelFee: 0,
      payoutSuccessCount: 0,
      payoutSuccessAmount: 0,
      payoutFee: 0,
      payoutChannelFee: 0,
      rechargeSuccessAmount: 0,
    };
    byKey.set(key, a);
    return a;
  };

  for (const r of collect) {
    const t = Number((r as any).successAtMs ?? 0);
    const bucket =
      parsed.data.groupBy === "merchant"
        ? String(r.merchantId)
        : parsed.data.groupBy === "payment_app"
          ? String(r.paymentAppId ?? "none")
          : ymdInTz(t, tz);
    const label =
      parsed.data.groupBy === "merchant"
        ? `${merchantById.get(String(r.merchantId))?.code ?? r.merchantId} ${merchantById.get(String(r.merchantId))?.name ?? ""}`.trim()
        : parsed.data.groupBy === "payment_app"
          ? (r.paymentAppId ? `${appById.get(String(r.paymentAppId))?.name ?? "App"} (${appById.get(String(r.paymentAppId))?.packageName ?? r.paymentAppId})` : "未指定支付APP")
          : bucket;
    const a = ensure(bucket, label);
    a.collectSuccessCount += 1;
    a.collectSuccessAmount += Number(r.amount ?? 0);
    a.collectFee += Number(r.fee ?? 0);
    a.collectChannelFee += Number(r.channelFee ?? 0);
  }

  for (const r of payout) {
    const t = Number((r as any).successAtMs ?? 0);
    const bucket =
      parsed.data.groupBy === "merchant"
        ? String(r.merchantId)
        : parsed.data.groupBy === "payment_app"
          ? "n/a"
          : ymdInTz(t, tz);
    const label =
      parsed.data.groupBy === "merchant"
        ? `${merchantById.get(String(r.merchantId))?.code ?? r.merchantId} ${merchantById.get(String(r.merchantId))?.name ?? ""}`.trim()
        : parsed.data.groupBy === "payment_app"
          ? "代付无支付APP维度"
          : bucket;
    const a = ensure(bucket, label);
    a.payoutSuccessCount += 1;
    a.payoutSuccessAmount += Number(r.amount ?? 0);
    a.payoutFee += Number(r.fee ?? 0);
    a.payoutChannelFee += Number(r.channelFee ?? 0);
  }

  for (const r of recharge) {
    const t = Number((r as any).creditedAtMs ?? 0);
    const bucket =
      parsed.data.groupBy === "merchant"
        ? String(r.merchantId)
        : parsed.data.groupBy === "payment_app"
          ? "n/a"
          : ymdInTz(t, tz);
    const label =
      parsed.data.groupBy === "merchant"
        ? `${merchantById.get(String(r.merchantId))?.code ?? r.merchantId} ${merchantById.get(String(r.merchantId))?.name ?? ""}`.trim()
        : parsed.data.groupBy === "payment_app"
          ? "充值无支付APP维度"
          : bucket;
    const a = ensure(bucket, label);
    a.rechargeSuccessAmount += Number(r.amount ?? 0);
  }

  let out = Array.from(byKey.values());
  out = parsed.data.groupBy === "day" ? out.sort((a, b) => a.key.localeCompare(b.key)) : out.sort((a, b) => b.collectSuccessAmount + b.payoutSuccessAmount - (a.collectSuccessAmount + a.payoutSuccessAmount));

  return NextResponse.json({
    ok: true,
    tz,
    dateFrom,
    dateTo,
    groupBy: parsed.data.groupBy,
    rows: out,
  });
}

