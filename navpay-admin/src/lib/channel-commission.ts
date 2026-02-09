import { db } from "@/lib/db";
import { getSystemConfigNumber } from "@/lib/system-config";
import { dec, feeFromBps, money2 } from "@/lib/money";
import { id } from "@/lib/id";
import {
  collectOrders,
  payoutOrders,
  paymentPersons,
  paymentPersonCommissionLogs,
} from "@/db/schema";
import { eq } from "drizzle-orm";

export const INDIA_TZ = "Asia/Kolkata";

export async function getChannelFeeRateBps(): Promise<number> {
  return await getSystemConfigNumber({
    key: "channel.fee_rate_bps",
    defaultValue: 450,
    min: 0,
    max: 10_000,
    description: "渠道订单收益费率（bps，4.5% = 450）。用于渠道用户“今日收益”等统计。",
  });
}

export async function getRebateBps(): Promise<{ l1: number; l2: number; l3: number }> {
  const l1 = await getSystemConfigNumber({
    key: "channel.rebate_l1_bps",
    defaultValue: 50,
    min: 0,
    max: 10_000,
    description: "团队返利：一级(直接上级)比例（bps，0.5% = 50）。实时结算。",
  });
  const l2 = await getSystemConfigNumber({
    key: "channel.rebate_l2_bps",
    defaultValue: 30,
    min: 0,
    max: 10_000,
    description: "团队返利：二级比例（bps，0.3% = 30）。实时结算。",
  });
  const l3 = await getSystemConfigNumber({
    key: "channel.rebate_l3_bps",
    defaultValue: 10,
    min: 0,
    max: 10_000,
    description: "团队返利：三级比例（bps，0.1% = 10）。实时结算。",
  });
  return { l1, l2, l3 };
}

export function calcAmountByBps(amount: string, bps: number): string {
  // bps: 1/100 of a percent
  return money2(dec(amount).mul(dec(bps)).div(10_000));
}

export async function calcChannelFeeForAmount(amount: string): Promise<string> {
  const bps = await getChannelFeeRateBps();
  return feeFromBps(amount, bps, "0.00").fee;
}

async function uplineChain3(personId: string): Promise<string[]> {
  const out: string[] = [];
  let cur = personId;
  for (let i = 0; i < 3; i++) {
    const rows = await db
      .select({ inviterPersonId: paymentPersons.inviterPersonId })
      .from(paymentPersons)
      .where(eq(paymentPersons.id, cur))
      .limit(1);
    const inviter = String((rows[0] as any)?.inviterPersonId ?? "");
    if (!inviter) break;
    out.push(inviter);
    cur = inviter;
  }
  return out;
}

async function insertCommissionOnce(opts: {
  personId: string;
  kind: "fee_collect" | "fee_payout" | "rebate_l1" | "rebate_l2" | "rebate_l3";
  amount: string;
  orderType: "collect" | "payout";
  orderId: string;
  sourcePersonId?: string | null;
  createdAtMs?: number;
}) {
  await db
    .insert(paymentPersonCommissionLogs)
    .values({
      id: id("ppc"),
      personId: opts.personId,
      kind: opts.kind,
      amount: opts.amount,
      orderType: opts.orderType,
      orderId: opts.orderId,
      sourcePersonId: opts.sourcePersonId ?? null,
      createdAtMs: opts.createdAtMs ?? Date.now(),
    } as any)
    .onConflictDoNothing();
}

export async function settleCollectOrderCommission(opts: { orderId: string; nowMs?: number }): Promise<void> {
  const nowMs = opts.nowMs ?? Date.now();
  const rows = await db.select().from(collectOrders).where(eq(collectOrders.id, opts.orderId)).limit(1);
  const o: any = rows[0];
  if (!o) return;
  if (String(o.status) !== "SUCCESS") return;
  const personId = String(o.assignedPaymentPersonId ?? "");
  if (!personId) return;

  // Persist channelFee for auditability (computed if missing).
  let fee = String(o.channelFee ?? "0.00");
  if (!fee || fee === "0" || fee === "0.0") fee = "0.00";
  if (fee === "0.00") {
    fee = await calcChannelFeeForAmount(String(o.amount ?? "0.00"));
    await db
      .update(collectOrders)
      .set({ channelFee: fee, updatedAtMs: nowMs } as any)
      .where(eq(collectOrders.id, o.id));
  }

  // Fee commission for the handler.
  await insertCommissionOnce({
    personId,
    kind: "fee_collect",
    amount: fee,
    orderType: "collect",
    orderId: String(o.id),
    sourcePersonId: personId,
    createdAtMs: nowMs,
  });

  // Multi-level rebates (based on order amount).
  const uplines = await uplineChain3(personId);
  const rates = await getRebateBps();
  const amount = String(o.amount ?? "0.00");
  const rebateAmts = [calcAmountByBps(amount, rates.l1), calcAmountByBps(amount, rates.l2), calcAmountByBps(amount, rates.l3)];
  const kinds: any[] = ["rebate_l1", "rebate_l2", "rebate_l3"];
  for (let i = 0; i < uplines.length; i++) {
    const u = uplines[i];
    const a = rebateAmts[i] ?? "0.00";
    if (!u) continue;
    if (a === "0.00") continue;
    await insertCommissionOnce({
      personId: u,
      kind: kinds[i],
      amount: a,
      orderType: "collect",
      orderId: String(o.id),
      sourcePersonId: personId,
      createdAtMs: nowMs,
    });
  }
}

export async function settlePayoutOrderCommission(opts: { orderId: string; nowMs?: number }): Promise<void> {
  const nowMs = opts.nowMs ?? Date.now();
  const rows = await db.select().from(payoutOrders).where(eq(payoutOrders.id, opts.orderId)).limit(1);
  const o: any = rows[0];
  if (!o) return;
  if (String(o.status) !== "SUCCESS") return;
  const personId = String(o.lockedPaymentPersonId ?? "");
  if (!personId) return;

  let fee = String(o.channelFee ?? "0.00");
  if (!fee || fee === "0" || fee === "0.0") fee = "0.00";
  if (fee === "0.00") {
    fee = await calcChannelFeeForAmount(String(o.amount ?? "0.00"));
    await db
      .update(payoutOrders)
      .set({ channelFee: fee, updatedAtMs: nowMs } as any)
      .where(eq(payoutOrders.id, o.id));
  }

  await insertCommissionOnce({
    personId,
    kind: "fee_payout",
    amount: fee,
    orderType: "payout",
    orderId: String(o.id),
    sourcePersonId: personId,
    createdAtMs: nowMs,
  });

  const uplines = await uplineChain3(personId);
  const rates = await getRebateBps();
  const amount = String(o.amount ?? "0.00");
  const rebateAmts = [calcAmountByBps(amount, rates.l1), calcAmountByBps(amount, rates.l2), calcAmountByBps(amount, rates.l3)];
  const kinds: any[] = ["rebate_l1", "rebate_l2", "rebate_l3"];
  for (let i = 0; i < uplines.length; i++) {
    const u = uplines[i];
    const a = rebateAmts[i] ?? "0.00";
    if (!u) continue;
    if (a === "0.00") continue;
    await insertCommissionOnce({
      personId: u,
      kind: kinds[i],
      amount: a,
      orderType: "payout",
      orderId: String(o.id),
      sourcePersonId: personId,
      createdAtMs: nowMs,
    });
  }
}

