import { sqlite, db } from "@/lib/db";
import { rechargeOrders, merchants } from "@/db/schema";
import { and, eq, inArray, lt } from "drizzle-orm";
import { id } from "@/lib/id";
import type { RechargeChain } from "@/lib/recharge-hd";
import { dec, money2 } from "@/lib/money";
import { writeAuditLog } from "@/lib/audit";
import { getRechargeConfirmationsRequired } from "@/lib/recharge-config.server";

export type RechargeStatus = "CONFIRMING" | "SUCCESS" | "FAILED";

export type RechargeTx = {
  chain: RechargeChain;
  asset?: string; // default USDT
  txHash: string;
  address: string; // deposit address (to)
  fromAddress?: string | null;
  toAddress?: string | null;
  amount: string;
  blockNumber: number;
};

export async function upsertRechargeFromTx(opts: { req: Request; merchantId: string; tx: RechargeTx }): Promise<{ ok: boolean; orderId?: string; existed?: boolean; status?: RechargeStatus }> {
  const asset = (opts.tx.asset ?? "USDT").trim() || "USDT";
  const required = await getRechargeConfirmationsRequired(opts.tx.chain);

  // Fast-path: if exists, return.
  const ex = await db
    .select({ id: rechargeOrders.id, status: rechargeOrders.status })
    .from(rechargeOrders)
    .where(and(eq(rechargeOrders.chain, opts.tx.chain), eq(rechargeOrders.txHash, opts.tx.txHash)))
    .limit(1);
  if (ex[0]) return { ok: true, orderId: String((ex[0] as any).id), existed: true, status: String((ex[0] as any).status) as any };

  const run = sqlite.transaction(() => {
    const now = Date.now();
    // Re-check inside transaction.
    const ex2 = sqlite.prepare("SELECT id, status FROM recharge_orders WHERE chain = ? AND tx_hash = ? LIMIT 1").get(opts.tx.chain, opts.tx.txHash) as any;
    if (ex2) return { ok: true, orderId: String(ex2.id), existed: true, status: String(ex2.status) as RechargeStatus };

    const rid = id("rc");
    sqlite
      .prepare(
        "INSERT INTO recharge_orders (id, merchant_id, chain, asset, address, tx_hash, from_address, to_address, amount, status, block_number, confirmations, confirmations_required, credited_at_ms, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        rid,
        opts.merchantId,
        opts.tx.chain,
        asset,
        opts.tx.address,
        opts.tx.txHash,
        opts.tx.fromAddress ?? null,
        opts.tx.toAddress ?? null,
        opts.tx.amount,
        "CONFIRMING",
        opts.tx.blockNumber,
        0,
        required,
        null,
        now,
        now,
      );
    return { ok: true, orderId: rid, existed: false, status: "CONFIRMING" as RechargeStatus };
  });

  const out = run();

  await writeAuditLog({
    req: opts.req as any,
    actorUserId: null,
    merchantId: opts.merchantId,
    action: "recharge.detected",
    entityType: "recharge_order",
    entityId: out.orderId!,
    meta: { chain: opts.tx.chain, asset, txHash: opts.tx.txHash, amount: opts.tx.amount, address: opts.tx.address, blockNumber: opts.tx.blockNumber },
  });

  return out;
}

export async function processRechargeConfirmations(opts: { req: Request; chain: RechargeChain; headBlockNumber: number }): Promise<{ ok: boolean; updated: number; credited: number }> {
  const head = Math.max(0, Math.floor(Number(opts.headBlockNumber) || 0));
  const rows = await db
    .select()
    .from(rechargeOrders)
    .where(and(eq(rechargeOrders.chain, opts.chain), eq(rechargeOrders.status, "CONFIRMING")))
    .limit(500);

  let updated = 0;
  let credited = 0;

  for (const r of rows as any[]) {
    const bn = r.blockNumber;
    if (bn === null || bn === undefined) continue;
    const conf = Math.max(0, head - Number(bn) + 1);
    const reqConf = Number(r.confirmationsRequired ?? 15);

    // Always keep confirmations fresh for UI.
    await db.update(rechargeOrders).set({ confirmations: conf, updatedAtMs: Date.now() } as any).where(eq(rechargeOrders.id, r.id));
    updated++;

    if (conf < reqConf) continue;

    const run = sqlite.transaction(() => {
      const now = Date.now();
      const cur = sqlite.prepare("SELECT status, credited_at_ms, merchant_id, amount FROM recharge_orders WHERE id = ? LIMIT 1").get(r.id) as any;
      if (!cur) return { didCredit: false };
      if (String(cur.status) === "SUCCESS" || cur.credited_at_ms) return { didCredit: false };

      sqlite.prepare("UPDATE recharge_orders SET status = 'SUCCESS', credited_at_ms = ?, updated_at_ms = ? WHERE id = ?").run(now, now, r.id);

      const m = sqlite.prepare("SELECT balance FROM merchants WHERE id = ? LIMIT 1").get(String(cur.merchant_id)) as any;
      const bal = m?.balance ? String(m.balance) : "0";
      const newBal = money2(dec(bal).add(dec(String(cur.amount))));
      sqlite.prepare("UPDATE merchants SET balance = ?, updated_at_ms = ? WHERE id = ?").run(newBal, now, String(cur.merchant_id));

      return { didCredit: true, merchantId: String(cur.merchant_id), amount: String(cur.amount) };
    });

    const out = run();
    if (out.didCredit) {
      credited++;
      await writeAuditLog({
        req: opts.req as any,
        actorUserId: null,
        merchantId: out.merchantId,
        action: "recharge.credited",
        entityType: "recharge_order",
        entityId: String(r.id),
        meta: { chain: opts.chain, amount: out.amount, headBlockNumber: head, confirmations: conf, confirmationsRequired: reqConf },
      });
    }
  }

  return { ok: true, updated, credited };
}
