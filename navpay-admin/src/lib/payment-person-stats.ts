import { db } from "@/lib/db";
import { dayRangeMsInTz } from "@/lib/day-range";
import { INDIA_TZ } from "@/lib/channel-commission";
import {
  collectOrders,
  payoutOrders,
  paymentPersons,
  paymentPersonCommissionLogs,
  paymentPersonLoginLogs,
  users,
} from "@/db/schema";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

export type TodayOrderStats = {
  collectCount: number;
  collectFee: string;
  payoutCount: number;
  payoutFee: string;
  totalCount: number;
  totalFee: string;
};

export type TodayRebateStats = {
  rebateL1: string;
  rebateL2: string;
  rebateL3: string;
  rebateTotal: string;
};

function money2(n: number): string {
  // avoid importing Decimal for simple aggregate formatting
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

export function indiaTodayRangeMs(nowMs: number): { startMs: number; endMs: number } {
  return dayRangeMsInTz({ nowMs, timeZone: INDIA_TZ });
}

export async function getLastLoginByPersonIds(personIds: string[]): Promise<Record<string, { ip: string | null; atMs: number }>> {
  const out: Record<string, { ip: string | null; atMs: number }> = {};
  if (!personIds.length) return out;
  // Order desc and keep first per personId.
  const rows = await db
    .select({
      personId: paymentPersonLoginLogs.personId,
      ip: paymentPersonLoginLogs.ip,
      createdAtMs: paymentPersonLoginLogs.createdAtMs,
    })
    .from(paymentPersonLoginLogs)
    .where(and(inArray(paymentPersonLoginLogs.personId, personIds as any), eq(paymentPersonLoginLogs.event, "LOGIN")))
    .orderBy(desc(paymentPersonLoginLogs.createdAtMs))
    .limit(personIds.length * 3);
  for (const r of rows as any[]) {
    const pid = String(r.personId);
    if (out[pid]) continue;
    out[pid] = { ip: r.ip ? String(r.ip) : null, atMs: Number(r.createdAtMs ?? 0) };
  }
  return out;
}

export async function getDirectDownlineCountByPersonIds(personIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!personIds.length) return out;
  const rows = await db
    .select({
      inviterPersonId: paymentPersons.inviterPersonId,
      c: sql<number>`count(*)`,
    })
    .from(paymentPersons)
    .where(and(isNotNull(paymentPersons.inviterPersonId), inArray(paymentPersons.inviterPersonId, personIds as any)))
    .groupBy(paymentPersons.inviterPersonId);
  for (const r of rows as any[]) {
    const pid = String(r.inviterPersonId);
    out[pid] = Number(r.c ?? 0);
  }
  return out;
}

export async function getTodayOrderStatsByPersonIds(opts: { personIds: string[]; nowMs: number }): Promise<Record<string, TodayOrderStats>> {
  const out: Record<string, TodayOrderStats> = {};
  const { startMs, endMs } = indiaTodayRangeMs(opts.nowMs);
  const ids = opts.personIds;
  if (!ids.length) return out;

  const cRows = await db
    .select({
      personId: collectOrders.assignedPaymentPersonId,
      c: sql<number>`count(*)`,
      fee: sql<number>`coalesce(sum(cast(${collectOrders.channelFee} as real)), 0)`,
    })
    .from(collectOrders)
    .where(
      and(
        isNotNull(collectOrders.assignedPaymentPersonId),
        inArray(collectOrders.assignedPaymentPersonId, ids as any),
        eq(collectOrders.status, "SUCCESS"),
        sql`${collectOrders.successAtMs} >= ${startMs} and ${collectOrders.successAtMs} < ${endMs}`,
      ) as any,
    )
    .groupBy(collectOrders.assignedPaymentPersonId);

  const pRows = await db
    .select({
      personId: payoutOrders.lockedPaymentPersonId,
      c: sql<number>`count(*)`,
      fee: sql<number>`coalesce(sum(cast(${payoutOrders.channelFee} as real)), 0)`,
    })
    .from(payoutOrders)
    .where(
      and(
        isNotNull(payoutOrders.lockedPaymentPersonId),
        inArray(payoutOrders.lockedPaymentPersonId, ids as any),
        eq(payoutOrders.status, "SUCCESS"),
        sql`${payoutOrders.successAtMs} >= ${startMs} and ${payoutOrders.successAtMs} < ${endMs}`,
      ) as any,
    )
    .groupBy(payoutOrders.lockedPaymentPersonId);

  for (const pid of ids) {
    out[String(pid)] = { collectCount: 0, collectFee: "0.00", payoutCount: 0, payoutFee: "0.00", totalCount: 0, totalFee: "0.00" };
  }

  for (const r of cRows as any[]) {
    const pid = String(r.personId);
    if (!pid) continue;
    const st = out[pid] ?? { collectCount: 0, collectFee: "0.00", payoutCount: 0, payoutFee: "0.00", totalCount: 0, totalFee: "0.00" };
    st.collectCount = Number(r.c ?? 0);
    st.collectFee = money2(Number(r.fee ?? 0));
    out[pid] = st;
  }
  for (const r of pRows as any[]) {
    const pid = String(r.personId);
    if (!pid) continue;
    const st = out[pid] ?? { collectCount: 0, collectFee: "0.00", payoutCount: 0, payoutFee: "0.00", totalCount: 0, totalFee: "0.00" };
    st.payoutCount = Number(r.c ?? 0);
    st.payoutFee = money2(Number(r.fee ?? 0));
    out[pid] = st;
  }

  for (const pid of Object.keys(out)) {
    const st = out[pid];
    st.totalCount = st.collectCount + st.payoutCount;
    st.totalFee = money2(Number(st.collectFee) + Number(st.payoutFee));
  }

  return out;
}

export async function getTodayRebateStatsByPersonIds(opts: { personIds: string[]; nowMs: number }): Promise<Record<string, TodayRebateStats>> {
  const out: Record<string, TodayRebateStats> = {};
  const { startMs, endMs } = indiaTodayRangeMs(opts.nowMs);
  const ids = opts.personIds;
  if (!ids.length) return out;

  const rows = await db
    .select({
      personId: paymentPersonCommissionLogs.personId,
      kind: paymentPersonCommissionLogs.kind,
      amt: sql<number>`coalesce(sum(cast(${paymentPersonCommissionLogs.amount} as real)), 0)`,
    })
    .from(paymentPersonCommissionLogs)
    .where(
      and(
        inArray(paymentPersonCommissionLogs.personId, ids as any),
        sql`${paymentPersonCommissionLogs.createdAtMs} >= ${startMs} and ${paymentPersonCommissionLogs.createdAtMs} < ${endMs}`,
        inArray(paymentPersonCommissionLogs.kind, ["rebate_l1", "rebate_l2", "rebate_l3"] as any),
      ) as any,
    )
    .groupBy(paymentPersonCommissionLogs.personId, paymentPersonCommissionLogs.kind);

  for (const pid of ids) {
    out[String(pid)] = { rebateL1: "0.00", rebateL2: "0.00", rebateL3: "0.00", rebateTotal: "0.00" };
  }

  for (const r of rows as any[]) {
    const pid = String(r.personId);
    const k = String(r.kind);
    const amt = money2(Number(r.amt ?? 0));
    const st = out[pid] ?? { rebateL1: "0.00", rebateL2: "0.00", rebateL3: "0.00", rebateTotal: "0.00" };
    if (k === "rebate_l1") st.rebateL1 = amt;
    if (k === "rebate_l2") st.rebateL2 = amt;
    if (k === "rebate_l3") st.rebateL3 = amt;
    out[pid] = st;
  }

  for (const pid of Object.keys(out)) {
    const st = out[pid];
    st.rebateTotal = money2(Number(st.rebateL1) + Number(st.rebateL2) + Number(st.rebateL3));
  }

  return out;
}

export async function getUplineChain(opts: { personId: string; maxDepth?: number }): Promise<{ id: string; name: string; username: string | null; inviteCode: string | null }[]> {
  const maxDepth = Math.max(1, Math.min(10, opts.maxDepth ?? 3));
  const out: { id: string; name: string; username: string | null; inviteCode: string | null }[] = [];
  let cur = opts.personId;
  for (let i = 0; i < maxDepth; i++) {
    const rows = await db
      .select({
        inviterPersonId: paymentPersons.inviterPersonId,
      })
      .from(paymentPersons)
      .where(eq(paymentPersons.id, cur))
      .limit(1);
    const inviterId = String((rows[0] as any)?.inviterPersonId ?? "");
    if (!inviterId) break;

    const invRows = await db
      .select({
        id: paymentPersons.id,
        name: paymentPersons.name,
        inviteCode: paymentPersons.inviteCode,
        username: users.username,
      })
      .from(paymentPersons)
      .leftJoin(users, eq(users.id, paymentPersons.userId))
      .where(eq(paymentPersons.id, inviterId))
      .limit(1);
    const inv = invRows[0] as any;
    if (!inv) break;
    out.push({ id: String(inv.id), name: String(inv.name), username: inv.username ? String(inv.username) : null, inviteCode: inv.inviteCode ? String(inv.inviteCode) : null });
    cur = inviterId;
  }
  return out;
}

