import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { paymentPersons } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiPerm, requireApiUser } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const schema = z.object({
  enabled: z.boolean(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ personId: string }> }) {
  await requireApiPerm(req, "payout.channel.write");
  const { personId } = await ctx.params;
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const row = await db.select({ id: paymentPersons.id, enabled: paymentPersons.enabled }).from(paymentPersons).where(eq(paymentPersons.id, personId)).limit(1);
  const cur = row[0];
  if (!cur) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  await db
    .update(paymentPersons)
    .set({ enabled: body.data.enabled, updatedAtMs: Date.now() } as any)
    .where(eq(paymentPersons.id, personId));

  const { uid } = await requireApiUser(req, { csrf: false });
  await writeAuditLog({
    req,
    actorUserId: uid,
    action: body.data.enabled ? "payment_person.enable" : "payment_person.disable",
    entityType: "payment_person",
    entityId: personId,
    meta: { from: Boolean(cur.enabled), to: body.data.enabled },
  });

  return NextResponse.json({ ok: true });
}

