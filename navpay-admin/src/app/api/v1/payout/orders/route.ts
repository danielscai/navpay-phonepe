import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { merchantFees, merchants, payoutOrders } from "@/db/schema";
import { db } from "@/lib/db";
import { id } from "@/lib/id";
import { dec, feeFromBps, money2 } from "@/lib/money";
import { requireMerchantApiKey } from "@/lib/merchant-apikey";
import { payoutCreateReq, payoutCreateResp } from "@/lib/merchant-api/v1/contract";
import { enforceMerchantLimit } from "@/lib/merchant-limits";
import { writeAuditLog } from "@/lib/audit";

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
  try {
    const auth = await requireMerchantApiKey(req);
    const merchantId = auth.merchantId;

    const parsed = payoutCreateReq.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

    const dup = await db
      .select({ id: payoutOrders.id })
      .from(payoutOrders)
      .where(and(eq(payoutOrders.merchantId, merchantId), eq(payoutOrders.merchantOrderNo, parsed.data.merchantOrderNo)))
      .limit(1);
    if (dup.length) return NextResponse.json({ ok: false, error: "duplicate_merchant_order_no" }, { status: 409 });

    await enforceMerchantLimit({ merchantId, type: "payout", amount: parsed.data.amount });

    const feeRow = await db.select().from(merchantFees).where(eq(merchantFees.merchantId, merchantId)).limit(1);
    const fees = feeRow[0] ?? { payoutFeeRateBps: 450, minFee: "0.00" };
    const { fee } = feeFromBps(parsed.data.amount, (fees as any).payoutFeeRateBps ?? 450, (fees as any).minFee ?? "0.00");

    const mRow = await db.select().from(merchants).where(eq(merchants.id, merchantId)).limit(1);
    const m = mRow[0];
    if (!m) return NextResponse.json({ ok: false, error: "merchant_not_found" }, { status: 404 });

    const need = dec(parsed.data.amount).add(dec(fee));
    const bal = dec(m.balance);
    if (bal.lessThan(need)) return NextResponse.json({ ok: false, error: "insufficient_balance" }, { status: 400 });

    const newBal = money2(bal.sub(need));
    const newFrozen = money2(dec(m.payoutFrozen).add(need));

    const orderId = id("po");
    const now = Date.now();

    await db.update(merchants).set({ balance: newBal, payoutFrozen: newFrozen, updatedAtMs: now }).where(eq(merchants.id, merchantId));
    await db.insert(payoutOrders).values({
      id: orderId,
      merchantId,
      merchantOrderNo: parsed.data.merchantOrderNo,
      amount: parsed.data.amount,
      fee,
      status: "REVIEW_PENDING",
      notifyUrl: parsed.data.notifyUrl,
      remark: parsed.data.remark ?? null,
      beneficiaryName: parsed.data.beneficiaryName,
      bankName: parsed.data.bankName ?? null,
      accountNo: parsed.data.accountNo,
      ifsc: parsed.data.ifsc,
      createdAtMs: now,
      updatedAtMs: now,
    } as any);

    await writeAuditLog({
      req,
      actorUserId: null,
      merchantId,
      action: "merchant_api.payout.create",
      entityType: "payout_order",
      entityId: orderId,
      meta: { merchantOrderNo: parsed.data.merchantOrderNo, amount: parsed.data.amount },
    });

    const resp = payoutCreateResp.safeParse({ ok: true, data: { orderId, status: "REVIEW_PENDING", fee, createdAtMs: now } });
    if (!resp.success) return NextResponse.json({ ok: true, data: { orderId, status: "REVIEW_PENDING", fee, createdAtMs: now } });
    return NextResponse.json(resp.data);
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "";
    if (msg.includes("payout_orders_merchant_order_ux")) {
      const mapped = mapErr({ status: 409 });
      return NextResponse.json(mapped.body, { status: mapped.status });
    }
    if (e instanceof z.ZodError) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
    const mapped = mapErr(e);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
