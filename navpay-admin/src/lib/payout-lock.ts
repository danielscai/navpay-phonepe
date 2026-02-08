import { db } from "@/lib/db";
import { payoutOrders } from "@/db/schema";
import { and, eq, lte } from "drizzle-orm";
import { getSystemConfigNumber } from "@/lib/system-config";

export const PAYOUT_LOCK_TIMEOUT_MINUTES_KEY = "payout.lock_timeout_minutes";

export async function getPayoutLockTimeoutMinutes(): Promise<number> {
  return await getSystemConfigNumber({
    key: PAYOUT_LOCK_TIMEOUT_MINUTES_KEY,
    defaultValue: 10,
    min: 1,
    max: 120,
    description: "代付订单抢单锁定超时分钟数。默认 10 分钟。",
  });
}

export async function sweepExpiredPayoutLocks(nowMs: number): Promise<{ released: number }> {
  // Auto-locks only. Manual locks require CS/admin action.
  const due = await db
    .select({ id: payoutOrders.id })
    .from(payoutOrders)
    .where(and(eq(payoutOrders.status, "LOCKED"), eq(payoutOrders.lockMode, "AUTO"), lte(payoutOrders.lockExpiresAtMs, nowMs)));

  if (!due.length) return { released: 0 };
  const ids = due.map((x: any) => String(x.id));

  // Release back to APPROVED (open for claim).
  for (const orderId of ids) {
    await db
      .update(payoutOrders)
      .set({
        status: "APPROVED",
        lockedPaymentPersonId: null as any,
        lockMode: "AUTO",
        lockedAtMs: null as any,
        lockExpiresAtMs: null as any,
        updatedAtMs: nowMs,
      } as any)
      .where(eq(payoutOrders.id, orderId));
  }

  return { released: ids.length };
}
