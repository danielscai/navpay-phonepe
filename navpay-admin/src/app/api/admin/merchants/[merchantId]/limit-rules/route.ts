import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { merchantLimitRules } from "@/db/schema";
import { eq } from "drizzle-orm";
import { id } from "@/lib/id";
import { requireApiPerm } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  type: z.enum(["collect", "payout"]),
  minAmount: z.string().default("0"),
  maxAmount: z.string().default("0"),
  dailyCountLimit: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
  note: z.string().optional(),
});

export async function GET(req: NextRequest, ctx: { params: Promise<{ merchantId: string }> }) {
  await requireApiPerm(req, "merchant.read");
  const { merchantId } = await ctx.params;
  const rows = await db.select().from(merchantLimitRules).where(eq(merchantLimitRules.merchantId, merchantId));
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ merchantId: string }> }) {
  const { uid } = await requireApiPerm(req, "merchant.write");
  const { merchantId } = await ctx.params;
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const ruleId = id("mlr");
  await db.insert(merchantLimitRules).values({
    id: ruleId,
    merchantId,
    type: body.data.type,
    minAmount: body.data.minAmount,
    maxAmount: body.data.maxAmount,
    dailyCountLimit: body.data.dailyCountLimit,
    enabled: body.data.enabled,
    note: body.data.note ?? null,
    createdAtMs: Date.now(),
  });

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "merchant.limit_rule_create",
    entityType: "merchant_limit_rule",
    entityId: ruleId,
    meta: { merchantId, ...body.data },
  });

  return NextResponse.json({ ok: true, id: ruleId });
}

