import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { collectOrders, merchantFees } from "@/db/schema";
import { db } from "@/lib/db";
import { id } from "@/lib/id";
import { feeFromBps } from "@/lib/money";
import { requireMerchantApiKey } from "@/lib/merchant-apikey";
import { collectCreateReq, collectCreateResp } from "@/lib/merchant-api/v1/contract";
import { enforceMerchantLimit } from "@/lib/merchant-limits";
import { writeAuditLog } from "@/lib/audit";
import { pickPaymentPersonForAmount } from "@/lib/payment-person";

function mapErr(e: any): { status: number; body: any } {
  const st = Number(e?.status ?? 500);
  const msg = typeof e?.message === "string" ? e.message : "error";
  if (st === 401) return { status: 401, body: { ok: false, error: "unauthorized" } };
  if (st === 403) return { status: 403, body: { ok: false, error: msg === "ip_not_allowed" ? "ip_not_allowed" : "forbidden" } };
  if (st === 409) return { status: 409, body: { ok: false, error: "duplicate_merchant_order_no" } };
  if (st === 429) return { status: 429, body: { ok: false, error: msg } };
  if (st === 400) return { status: 400, body: { ok: false, error: msg } };
  return { status: 500, body: { ok: false, error: "server_error" } };
}

export async function POST(req: NextRequest) {
  let merchantId: string | null = null;
  try {
    const auth = await requireMerchantApiKey(req);
    merchantId = auth.merchantId;

    const parsed = collectCreateReq.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

    const dup = await db
      .select({ id: collectOrders.id })
      .from(collectOrders)
      .where(and(eq(collectOrders.merchantId, merchantId), eq(collectOrders.merchantOrderNo, parsed.data.merchantOrderNo)))
      .limit(1);
    if (dup.length) return NextResponse.json({ ok: false, error: "duplicate_merchant_order_no" }, { status: 409 });

    await enforceMerchantLimit({ merchantId, type: "collect", amount: parsed.data.amount });

    const feeRow = await db.select().from(merchantFees).where(eq(merchantFees.merchantId, merchantId)).limit(1);
    const fees = feeRow[0] ?? { collectFeeRateBps: 300, minFee: "0.00" };
    const { fee } = feeFromBps(parsed.data.amount, (fees as any).collectFeeRateBps ?? 300, (fees as any).minFee ?? "0.00");

    const orderId = id("co");
    const now = Date.now();

    await db.insert(collectOrders).values({
      id: orderId,
      merchantId,
      merchantOrderNo: parsed.data.merchantOrderNo,
      amount: parsed.data.amount,
      fee,
      status: "CREATED",
      notifyUrl: parsed.data.notifyUrl,
      remark: parsed.data.remark ?? null,
      channelType: "h5",
      paymentAppId: null,
      h5SiteId: null,
      createdAtMs: now,
      updatedAtMs: now,
    } as any);

    // Best-effort: assign to a payment person who has sufficient balance.
    try {
      const p = await pickPaymentPersonForAmount(parsed.data.amount);
      if (p) {
        await db
          .update(collectOrders)
          .set({ assignedPaymentPersonId: p.id, assignedAtMs: Date.now(), updatedAtMs: Date.now() } as any)
          .where(eq(collectOrders.id, orderId));
      }
    } catch {
      // Ignore assignment errors in API create.
    }

    await writeAuditLog({
      req,
      actorUserId: null,
      merchantId,
      action: "merchant_api.collect.create",
      entityType: "collect_order",
      entityId: orderId,
      meta: { merchantOrderNo: parsed.data.merchantOrderNo, amount: parsed.data.amount },
    });

    const resp = collectCreateResp.safeParse({ ok: true, data: { orderId, status: "CREATED", fee, createdAtMs: now } });
    if (!resp.success) return NextResponse.json({ ok: true, data: { orderId, status: "CREATED", fee, createdAtMs: now } });
    return NextResponse.json(resp.data);
  } catch (e: any) {
    // Uniqueness conflict for merchantOrderNo.
    const msg = typeof e?.message === "string" ? e.message : "";
    if (msg.includes("collect_orders_merchant_order_ux")) {
      const mapped = mapErr({ status: 409 });
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    if (e instanceof z.ZodError) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    const mapped = mapErr(e);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
