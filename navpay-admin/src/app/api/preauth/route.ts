import "dotenv/config";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/password";
import { requireCsrf } from "@/lib/csrf";

const bodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  requireCsrf(req);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  const { username, password } = body.data;

  const row = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const u = row[0];
  if (!u) return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });

  const now = Date.now();
  if (u.lockUntilMs && u.lockUntilMs > now) {
    return NextResponse.json({ ok: false, error: "locked" }, { status: 429 });
  }

  const ok = await verifyPassword(u.passwordHash, password);
  if (!ok) {
    const nextFailed = (u.failedLoginCount ?? 0) + 1;
    const lockUntilMs = nextFailed >= 5 ? Date.now() + 15 * 60 * 1000 : u.lockUntilMs ?? null;
    await db
      .update(users)
      .set({ failedLoginCount: nextFailed, lockUntilMs: lockUntilMs ?? undefined, updatedAtMs: Date.now() })
      .where(eq(users.id, u.id));
    return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
  }

  if (u.failedLoginCount !== 0 || u.lockUntilMs) {
    await db
      .update(users)
      .set({ failedLoginCount: 0, lockUntilMs: null as any, updatedAtMs: Date.now() })
      .where(eq(users.id, u.id));
  }

  return NextResponse.json({ ok: true, mustEnroll2fa: !!u.totpMustEnroll, totpEnabled: !!u.totpEnabled });
}
