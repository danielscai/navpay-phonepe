import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { collectOrders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { getOrderTimeoutMs, sweepExpiredCollectOrders } from "@/lib/order-timeout";

// Public debug-only endpoint: simulate user opening the pay page.
export async function POST(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { orderId } = await ctx.params;
  const timeoutMs = await getOrderTimeoutMs();

  await sweepExpiredCollectOrders(Date.now());
  const row = await db.select().from(collectOrders).where(eq(collectOrders.id, orderId)).limit(1);
  const o: any = row[0];
  if (!o) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const expiresAtMs = Number(o.createdAtMs) + timeoutMs;
  if (Date.now() >= expiresAtMs) {
    await sweepExpiredCollectOrders(Date.now());
    return NextResponse.json({ ok: false, error: "expired" }, { status: 400 });
  }

  // CREATED -> PENDING_PAY when user opens the page.
  if (String(o.status) === "CREATED") {
    await db.update(collectOrders).set({ status: "PENDING_PAY", updatedAtMs: Date.now() }).where(eq(collectOrders.id, orderId));
  }
  return NextResponse.json({ ok: true });
}

