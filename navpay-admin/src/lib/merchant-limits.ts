import { db } from "@/lib/db";
import { collectOrders, merchantLimitRules, payoutOrders } from "@/db/schema";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { dec } from "@/lib/money";

function utcDayRange(nowMs: number): { startMs: number; endMs: number } {
  const d = new Date(nowMs);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
  const end = start + 24 * 60 * 60 * 1000 - 1;
  return { startMs: start, endMs: end };
}

export async function enforceMerchantLimit(opts: { merchantId: string; type: "collect" | "payout"; amount: string }) {
  // We only apply the latest enabled rule for each (merchantId, type) to avoid ambiguous multi-rule behavior.
  const rules = await db
    .select()
    .from(merchantLimitRules)
    .where(and(eq(merchantLimitRules.merchantId, opts.merchantId), eq(merchantLimitRules.type, opts.type), eq(merchantLimitRules.enabled, true)))
    .orderBy(desc(merchantLimitRules.createdAtMs));

  const rule = rules[0];
  if (!rule) return;

  const amt = dec(opts.amount);
  const min = dec(rule.minAmount ?? "0");
  const max = dec(rule.maxAmount ?? "0");
  const minOk = amt.greaterThanOrEqualTo(min);
  const maxOk = max.equals(0) ? true : amt.lessThanOrEqualTo(max);
  if (!minOk || !maxOk) {
    const e = new Error("amount_out_of_range");
    (e as any).status = 400;
    throw e;
  }

  if ((rule.dailyCountLimit ?? 0) > 0) {
    const { startMs, endMs } = utcDayRange(Date.now());
    const tbl = opts.type === "collect" ? collectOrders : payoutOrders;
    const row = await db
      .select({ c: sql<number>`count(*)` })
      .from(tbl as any)
      .where(and(eq((tbl as any).merchantId, opts.merchantId), gte((tbl as any).createdAtMs, startMs), lte((tbl as any).createdAtMs, endMs)) as any)
      .limit(1);
    const cnt = Number((row[0] as any)?.c ?? 0);
    if (cnt >= rule.dailyCountLimit) {
      const e = new Error("daily_count_limit");
      (e as any).status = 429;
      throw e;
    }
  }
}
