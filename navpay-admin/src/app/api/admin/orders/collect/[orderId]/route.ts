import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { callbackAttempts, callbackTasks, collectOrders, merchants, paymentPersons } from "@/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";

export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  await requireApiPerm(req, "order.collect.read");
  const { orderId } = await ctx.params;

  const rows = await db
    .select({
      id: collectOrders.id,
      merchantId: collectOrders.merchantId,
      merchantCode: merchants.code,
      merchantName: merchants.name,
      merchantOrderNo: collectOrders.merchantOrderNo,
      amount: collectOrders.amount,
      fee: collectOrders.fee,
      status: collectOrders.status,
      notifyUrl: collectOrders.notifyUrl,
      notifyStatus: collectOrders.notifyStatus,
      lastNotifiedAtMs: collectOrders.lastNotifiedAtMs,
      assignedPaymentPersonId: collectOrders.assignedPaymentPersonId,
      assignedAtMs: collectOrders.assignedAtMs,
      assignedPaymentPersonName: paymentPersons.name,
      createdAtMs: collectOrders.createdAtMs,
      updatedAtMs: collectOrders.updatedAtMs,
    })
    .from(collectOrders)
    .leftJoin(merchants, eq(merchants.id, collectOrders.merchantId))
    .leftJoin(paymentPersons, eq(paymentPersons.id, collectOrders.assignedPaymentPersonId))
    .where(eq(collectOrders.id, orderId))
    .limit(1);
  const order = rows[0] ?? null;
  if (!order) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const tasks = await db
    .select()
    .from(callbackTasks)
    .where(and(eq(callbackTasks.orderType, "collect"), eq(callbackTasks.orderId, orderId)))
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
