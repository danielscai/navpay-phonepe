import { sqlite, db } from "@/lib/db";
import { merchants, rechargeIntents } from "@/db/schema";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { id } from "@/lib/id";
import type { RechargeChain } from "@/lib/recharge-hd-core";
import { ensureMerchantDepositAddress } from "@/lib/recharge-address";
import { getRechargeConfirmationsRequired } from "@/lib/recharge-config.server";
import { getOrderTimeoutMs } from "@/lib/order-timeout";
import { dec, money2 } from "@/lib/money";
import { writeAuditLog } from "@/lib/audit";

export type RechargeIntentStatus = "CREATED" | "CONFIRMING" | "SUCCESS" | "FAILED" | "EXPIRED";

export async function createRechargeIntent(opts: { req: Request; merchantId: string; chain: RechargeChain; expectedAmount: string }): Promise<{ ok: boolean; id?: string; error?: string }> {
  const addr = await ensureMerchantDepositAddress({ merchantId: opts.merchantId, chain: opts.chain });
  const required = await getRechargeConfirmationsRequired(opts.chain);
  const timeoutMs = await getOrderTimeoutMs();
  const now = Date.now();

  const intentId = id("rci");
  const merchantOrderNo = `RC_${now}`;

  await db.insert(rechargeIntents).values({
    id: intentId,
    merchantId: opts.merchantId,
    merchantOrderNo,
    chain: opts.chain,
    asset: "USDT",
    address: addr.address,
    expectedAmount: opts.expectedAmount,
    status: "CREATED",
    expiresAtMs: now + timeoutMs,
    confirmations: 0,
    confirmationsRequired: required,
    createdAtMs: now,
    updatedAtMs: now,
  } as any);

  await writeAuditLog({
    req: opts.req as any,
    actorUserId: null,
    merchantId: opts.merchantId,
    action: "recharge.intent_create",
    entityType: "recharge_intent",
    entityId: intentId,
    meta: { chain: opts.chain, expectedAmount: opts.expectedAmount, address: addr.address, confirmationsRequired: required },
  });

  return { ok: true, id: intentId };
}

export async function sweepExpiredRechargeIntents(nowMs: number): Promise<number> {
  const rows = await db
    .select({ id: rechargeIntents.id })
    .from(rechargeIntents)
    .where(and(eq(rechargeIntents.status, "CREATED"), lt(rechargeIntents.expiresAtMs, nowMs)))
    .limit(500);

  let changed = 0;
  for (const r of rows as any[]) {
    await db.update(rechargeIntents).set({ status: "EXPIRED", updatedAtMs: nowMs } as any).where(eq(rechargeIntents.id, r.id));
    changed++;
  }
  return changed;
}

export async function simulateChainEvent(opts: {
  req: Request;
  intentId: string;
  type: "SUCCESS" | "FAILED";
  txHash?: string;
  blockNumber?: number;
  fromAddress?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const row = await db.select().from(rechargeIntents).where(eq(rechargeIntents.id, opts.intentId)).limit(1);
  const o: any = row[0];
  if (!o) return { ok: false, error: "not_found" };
  if (String(o.status) !== "CREATED") return { ok: false, error: "bad_state" };

  const now = Date.now();
  if (opts.type === "FAILED") {
    await db.update(rechargeIntents).set({ status: "FAILED", updatedAtMs: now } as any).where(eq(rechargeIntents.id, opts.intentId));
    await writeAuditLog({
      req: opts.req as any,
      actorUserId: null,
      merchantId: String(o.merchantId),
      action: "recharge.chain_failed",
      entityType: "recharge_intent",
      entityId: opts.intentId,
      meta: { chain: o.chain },
    });
    return { ok: true };
  }

  const txHash = (opts.txHash ?? `SIM_${id("tx")}`).slice(0, 120);
  const bn = Number(opts.blockNumber ?? 0);
  await db
    .update(rechargeIntents)
    .set({
      status: "CONFIRMING",
      txHash,
      blockNumber: Number.isFinite(bn) ? bn : 0,
      confirmations: 0,
      fromAddress: opts.fromAddress ?? null,
      toAddress: String(o.address),
      updatedAtMs: now,
    } as any)
    .where(eq(rechargeIntents.id, opts.intentId));

  await writeAuditLog({
    req: opts.req as any,
    actorUserId: null,
    merchantId: String(o.merchantId),
    action: "recharge.chain_detected",
    entityType: "recharge_intent",
    entityId: opts.intentId,
    meta: { chain: o.chain, txHash, blockNumber: bn },
  });

  return { ok: true };
}

export async function processRechargeIntentConfirmations(opts: { req: Request; chain: RechargeChain; headBlockNumber: number }): Promise<{ ok: boolean; updated: number; credited: number }> {
  const head = Math.max(0, Math.floor(Number(opts.headBlockNumber) || 0));
  const rows = await db
    .select()
    .from(rechargeIntents)
    .where(and(eq(rechargeIntents.chain, opts.chain), eq(rechargeIntents.status, "CONFIRMING")))
    .orderBy(desc(rechargeIntents.createdAtMs))
    .limit(500);

  let updated = 0;
  let credited = 0;

  for (const r of rows as any[]) {
    const bn = r.blockNumber;
    if (bn === null || bn === undefined) continue;
    const conf = Math.max(0, head - Number(bn) + 1);
    const reqConf = Number(r.confirmationsRequired ?? 15);

    await db.update(rechargeIntents).set({ confirmations: conf, updatedAtMs: Date.now() } as any).where(eq(rechargeIntents.id, r.id));
    updated++;

    if (conf < reqConf) continue;

    const run = sqlite.transaction(() => {
      const now = Date.now();
      const cur = sqlite.prepare("SELECT status, credited_at_ms, merchant_id, expected_amount FROM recharge_intents WHERE id = ? LIMIT 1").get(String(r.id)) as any;
      if (!cur) return { didCredit: false };
      if (String(cur.status) === "SUCCESS" || cur.credited_at_ms) return { didCredit: false };

      sqlite.prepare("UPDATE recharge_intents SET status = 'SUCCESS', credited_at_ms = ?, updated_at_ms = ? WHERE id = ?").run(now, now, String(r.id));

      const m = sqlite.prepare("SELECT balance FROM merchants WHERE id = ? LIMIT 1").get(String(cur.merchant_id)) as any;
      const bal = m?.balance ? String(m.balance) : "0";
      const newBal = money2(dec(bal).add(dec(String(cur.expected_amount))));
      sqlite.prepare("UPDATE merchants SET balance = ?, updated_at_ms = ? WHERE id = ?").run(newBal, now, String(cur.merchant_id));

      return { didCredit: true, merchantId: String(cur.merchant_id), amount: String(cur.expected_amount) };
    });

    const out = run();
    if (out.didCredit) {
      credited++;
      await writeAuditLog({
        req: opts.req as any,
        actorUserId: null,
        merchantId: out.merchantId,
        action: "recharge.credited",
        entityType: "recharge_intent",
        entityId: String(r.id),
        meta: { chain: opts.chain, amount: out.amount, headBlockNumber: head, confirmations: conf, confirmationsRequired: reqConf },
      });
    }
  }

  return { ok: true, updated, credited };
}

