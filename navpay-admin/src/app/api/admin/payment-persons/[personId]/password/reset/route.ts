import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { paymentPersons, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireApiPerm, requireApiUser } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { hashPassword, validateStrongPassword } from "@/lib/password";

export async function POST(req: NextRequest, ctx: { params: Promise<{ personId: string }> }) {
  await requireApiPerm(req, "payout.channel.write");
  const { personId } = await ctx.params;

  const rows = await db
    .select({ userId: paymentPersons.userId })
    .from(paymentPersons)
    .where(eq(paymentPersons.id, personId))
    .limit(1);
  const userId = rows[0]?.userId as string | null | undefined;
  if (!userId) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const password = `NavPayPP@a${randomToken(6)}1!`;
  const ok = validateStrongPassword(password);
  if (!ok.ok) return NextResponse.json({ ok: false, error: "weak_password" }, { status: 500 });

  const passwordHash = await hashPassword(password);
  const now = Date.now();
  await db
    .update(users)
    .set({
      passwordHash,
      passwordUpdatedAtMs: now,
      failedLoginCount: 0,
      lockUntilMs: null as any,
      updatedAtMs: now,
    } as any)
    .where(eq(users.id, userId));

  const { uid } = await requireApiUser(req, { csrf: false });
  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "payment_person.reset_password",
    entityType: "payment_person",
    entityId: personId,
    meta: { userId },
  });

  return NextResponse.json({ ok: true, password });
}

