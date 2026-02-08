import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { merchantIpWhitelist } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { requireApiMerchantUser } from "@/lib/api-merchant";
import { id } from "@/lib/id";
import { writeAuditLog } from "@/lib/audit";
import { isStepUpSatisfied } from "@/lib/stepup";

const createSchema = z.object({
  ip: z.string().min(3).max(64),
  note: z.string().max(128).optional(),
  enabled: z.boolean().optional().default(true),
});

export async function GET(req: NextRequest) {
  const { merchantId } = await requireApiMerchantUser(req, { csrf: false });
  const rows = await db
    .select()
    .from(merchantIpWhitelist)
    .where(eq(merchantIpWhitelist.merchantId, merchantId))
    .orderBy(desc(merchantIpWhitelist.createdAtMs));
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  const { uid, merchantId } = await requireApiMerchantUser(req);
  if (!isStepUpSatisfied(req)) return NextResponse.json({ ok: false, error: "step_up_required" }, { status: 403 });
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const rowId = id("mip");
  try {
    await db.insert(merchantIpWhitelist).values({
      id: rowId,
      merchantId,
      ip: body.data.ip.trim(),
      note: body.data.note?.trim() || null,
      enabled: body.data.enabled ?? true,
      createdAtMs: Date.now(),
    });
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "";
    if (msg.includes("merchant_ip_whitelist_ux")) {
      return NextResponse.json({ ok: false, error: "duplicate_ip" }, { status: 409 });
    }
    throw e;
  }

  await writeAuditLog({
    req,
    actorUserId: uid,
    merchantId,
    action: "merchant.ip_whitelist_add",
    entityType: "merchant_ip_whitelist",
    entityId: rowId,
    meta: { ip: body.data.ip.trim(), enabled: body.data.enabled ?? true },
  });

  return NextResponse.json({ ok: true, id: rowId });
}
