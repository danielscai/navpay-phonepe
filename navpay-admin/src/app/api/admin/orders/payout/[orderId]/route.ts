import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { callbackAttempts, callbackTasks, merchants, payoutOrders, paymentPersons } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";

export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  await requireApiPerm(req, "order.payout.read");
  const { orderId } = await ctx.params;

  const rows = await db
    .select({
      id: payoutOrders.id,
      merchantId: payoutOrders.merchantId,
      merchantCode: merchants.code,
      merchantName: merchants.name,
      merchantOrderNo: payoutOrders.merchantOrderNo,
      amount: payoutOrders.amount,
      fee: payoutOrders.fee,
      status: payoutOrders.status,
      notifyUrl: payoutOrders.notifyUrl,
      notifyStatus: payoutOrders.notifyStatus,
      lastNotifiedAtMs: payoutOrders.lastNotifiedAtMs,
      lockedPaymentPersonId: payoutOrders.lockedPaymentPersonId,
      lockMode: payoutOrders.lockMode,
      lockedAtMs: payoutOrders.lockedAtMs,
      lockExpiresAtMs: payoutOrders.lockExpiresAtMs,
      lockedPaymentPersonName: paymentPersons.name,
      beneficiaryName: payoutOrders.beneficiaryName,
      accountNo: payoutOrders.accountNo,
      ifsc: payoutOrders.ifsc,
      createdAtMs: payoutOrders.createdAtMs,
      updatedAtMs: payoutOrders.updatedAtMs,
    })
    .from(payoutOrders)
    .leftJoin(merchants, eq(merchants.id, payoutOrders.merchantId))
    .leftJoin(paymentPersons, eq(paymentPersons.id, payoutOrders.lockedPaymentPersonId))
    .where(eq(payoutOrders.id, orderId))
    .limit(1);
  const order = rows[0] ?? null;
  if (!order) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const tasks = await db
    .select()
    .from(callbackTasks)
    .where(and(eq(callbackTasks.orderType, "payout"), eq(callbackTasks.orderId, orderId)))
    .orderBy(desc(callbackTasks.createdAtMs));

  const taskIds = tasks.map((t: any) => String(t.id));
  const attempts = taskIds.length
    ? await db.select().from(callbackAttempts).where(inArray(callbackAttempts.taskId, taskIds as any)).orderBy(desc(callbackAttempts.createdAtMs))
    : [];

  const attemptsByTaskId: Record<string, any[]> = {};
  for (const a of attempts as any[]) {
    const k = String(a.taskId);
    if (!attemptsByTaskId[k]) attemptsByTaskId[k] = [];
    attemptsByTaskId[k].push(a);
  }

  return NextResponse.json({ ok: true, order, tasks, attemptsByTaskId });
}
