import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/api";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword, validateStrongPassword, verifyPassword } from "@/lib/password";
import { writeAuditLog } from "@/lib/audit";

const schema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const { uid } = await requireApiUser(req);
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const row = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  const u = row[0];
  if (!u) return NextResponse.json({ ok: false, error: "no_user" }, { status: 404 });

  const okOld = await verifyPassword(u.passwordHash, body.data.oldPassword);
  if (!okOld) return NextResponse.json({ ok: false, error: "bad_old_password" }, { status: 400 });

  const strong = validateStrongPassword(body.data.newPassword);
  if (!strong.ok) return NextResponse.json({ ok: false, error: "weak_password", message: strong.reason }, { status: 400 });

  const ph = await hashPassword(body.data.newPassword);
  await db
    .update(users)
    .set({
      passwordHash: ph,
      passwordUpdatedAtMs: Date.now(),
      failedLoginCount: 0,
      lockUntilMs: null,
      updatedAtMs: Date.now(),
    })
    .where(eq(users.id, uid));

  await writeAuditLog({
    req,
    actorUserId: uid,
    merchantId: u.merchantId ?? null,
    action: "account.change_password",
    entityType: "user",
    entityId: uid,
    meta: {},
  });

  return NextResponse.json({ ok: true });
}
