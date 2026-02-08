import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { merchants, merchantFees } from "@/db/schema";
import { id } from "@/lib/id";
import { requireApiPerm } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "merchant.read");
  const rows = await db.select().from(merchants);
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  const { uid } = await requireApiPerm(req, "merchant.write");
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const merchantId = id("mch");
  await db.insert(merchants).values({
    id: merchantId,
    code: body.data.code,
    name: body.data.name,
    enabled: true,
    balance: "0.00",
    payoutFrozen: "0.00",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  });
  await db.insert(merchantFees).values({
    merchantId,
    collectFeeRateBps: 300,
    payoutFeeRateBps: 450,
    minFee: "0.00",
    updatedAtMs: Date.now(),
  });

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "merchant.create",
    entityType: "merchant",
    entityId: merchantId,
    meta: { code: body.data.code, name: body.data.name },
  });

  return NextResponse.json({ ok: true, id: merchantId });
}
