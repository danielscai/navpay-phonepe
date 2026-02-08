import { db } from "@/lib/db";
import { personalApiTokens, paymentPersons, users, paymentPersonLoginLogs, paymentPersonReportLogs } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { randomToken } from "@/lib/crypto";
import { verifyPassword } from "@/lib/password";
import { id } from "@/lib/id";
import { tokenHash } from "@/lib/personal-auth-core";

export { tokenHash };

export async function issuePersonalToken(opts: { username: string; password: string; ip?: string | null; userAgent?: string | null }) {
  const uRows = await db.select().from(users).where(eq(users.username, opts.username)).limit(1);
  const u: any = uRows[0];
  if (!u) return { ok: false as const, error: "invalid_credentials" };

  const ppRows = await db.select().from(paymentPersons).where(and(eq(paymentPersons.userId, u.id), eq(paymentPersons.enabled, true))).limit(1);
  const pp: any = ppRows[0];
  if (!pp) return { ok: false as const, error: "not_payment_person" };

  const passOk = await verifyPassword(String(u.passwordHash), opts.password);
  if (!passOk) return { ok: false as const, error: "invalid_credentials" };

  const token = randomToken(32);
  const th = tokenHash(token);
  const now = Date.now();
  const tokenId = id("pat");
  await db.insert(personalApiTokens).values({
    id: tokenId,
    personId: pp.id,
    tokenHash: th,
    createdAtMs: now,
    lastUsedAtMs: now,
    revokedAtMs: null,
  } as any);

  await db.insert(paymentPersonLoginLogs).values({
    id: id("pplog"),
    personId: pp.id,
    event: "LOGIN",
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
    createdAtMs: now,
  } as any);
  await db.insert(paymentPersonReportLogs).values({
    id: id("pprlog"),
    personId: pp.id,
    type: "LOGIN",
    entityType: "token",
    entityId: tokenId,
    metaJson: JSON.stringify({ username: opts.username }),
    createdAtMs: now,
  } as any);

  return { ok: true as const, token, personId: pp.id, person: { id: pp.id, name: pp.name, username: u.username } };
}

export async function revokePersonalToken(opts: { token: string; ip?: string | null; userAgent?: string | null }) {
  const th = tokenHash(opts.token);
  const rows = await db.select().from(personalApiTokens).where(and(eq(personalApiTokens.tokenHash, th), isNull(personalApiTokens.revokedAtMs))).limit(1);
  const t: any = rows[0];
  if (!t) return { ok: false as const, error: "not_found" };
  const now = Date.now();
  await db.update(personalApiTokens).set({ revokedAtMs: now } as any).where(eq(personalApiTokens.id, t.id));

  await db.insert(paymentPersonLoginLogs).values({
    id: id("pplog"),
    personId: t.personId,
    event: "LOGOUT",
    ip: opts.ip ?? null,
    userAgent: opts.userAgent ?? null,
    createdAtMs: now,
  } as any);
  await db.insert(paymentPersonReportLogs).values({
    id: id("pprlog"),
    personId: t.personId,
    type: "LOGOUT",
    entityType: "token",
    entityId: t.id,
    metaJson: JSON.stringify({}),
    createdAtMs: now,
  } as any);

  return { ok: true as const };
}

export async function requirePersonalToken(req: Request): Promise<{ personId: string; tokenId: string }> {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) {
    const e = new Error("unauthorized");
    (e as any).status = 401;
    throw e;
  }
  const token = m[1].trim();
  const th = tokenHash(token);
  const rows = await db
    .select()
    .from(personalApiTokens)
    .where(and(eq(personalApiTokens.tokenHash, th), isNull(personalApiTokens.revokedAtMs)))
    .limit(1);
  const t: any = rows[0];
  if (!t) {
    const e = new Error("unauthorized");
    (e as any).status = 401;
    throw e;
  }
  await db.update(personalApiTokens).set({ lastUsedAtMs: Date.now() } as any).where(eq(personalApiTokens.id, t.id));
  return { personId: String(t.personId), tokenId: String(t.id) };
}
