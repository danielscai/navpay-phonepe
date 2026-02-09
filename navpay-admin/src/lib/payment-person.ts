import { db } from "@/lib/db";
import { paymentPersonBalanceLogs, paymentPersons, users } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { id } from "@/lib/id";
import { dec, money2 } from "@/lib/money";
import { hashPassword, validateStrongPassword } from "@/lib/password";
import { randomToken } from "@/lib/crypto";
import crypto from "node:crypto";

export type PaymentPersonRow = typeof paymentPersons.$inferSelect;

export async function listPaymentPersons(): Promise<PaymentPersonRow[]> {
  return await db.select().from(paymentPersons).orderBy(desc(paymentPersons.createdAtMs));
}

export async function getPaymentPerson(personId: string): Promise<PaymentPersonRow | null> {
  const rows = await db.select().from(paymentPersons).where(eq(paymentPersons.id, personId)).limit(1);
  return rows[0] ?? null;
}

export async function createPaymentPerson(input: { name: string; balance?: string }): Promise<{ id: string }> {
  // Kept for backward compatibility; prefer createPaymentPersonWithUser.
  const out = await createPaymentPersonWithUser({ name: input.name, balance: input.balance });
  return { id: out.id };
}

export async function createPaymentPersonWithUser(input: {
  name: string;
  balance?: string;
  username?: string;
  password?: string;
  inviterCode?: string;
}): Promise<{ id: string; userId: string; username: string; password: string; inviteCode: string; inviterPersonId?: string | null }> {
  const now = Date.now();

  const makeUsername = async (): Promise<string> => {
    if (input.username?.trim()) {
      const u = input.username.trim();
      const exists = await db.select({ id: users.id }).from(users).where(eq(users.username, u)).limit(1);
      if (exists.length) {
        const e = new Error("username_taken");
        (e as any).status = 409;
        throw e;
      }
      return u;
    }
    for (let i = 0; i < 6; i++) {
      const u = `pp_${randomToken(6)}`;
      const exists = await db.select({ id: users.id }).from(users).where(eq(users.username, u)).limit(1);
      if (!exists.length) return u;
    }
    const e = new Error("username_generate_failed");
    (e as any).status = 500;
    throw e;
  };

  const username = await makeUsername();
  const password =
    input.password?.trim() ||
    // ensure strong password: upper + lower + digit + symbol and length >= 12
    `NavPayPP@a${randomToken(6)}1!`;
  const ok = validateStrongPassword(password);
  if (!ok.ok) {
    const e = new Error(ok.reason ?? "weak_password");
    (e as any).status = 400;
    throw e;
  }

  const passwordHash = await hashPassword(password);
  const userId = id("user");
  await db.insert(users).values({
    id: userId,
    username,
    email: null as any,
    displayName: input.name,
    merchantId: null as any,
    passwordHash,
    passwordUpdatedAtMs: now,
    totpEnabled: false,
    totpMustEnroll: false,
    createdAtMs: now,
    updatedAtMs: now,
  } as any);

  const personId = id("pp");

  const inviterCode = input.inviterCode?.trim().toUpperCase() || "";
  let inviterPersonId: string | null = null;
  if (inviterCode) {
    const invRows = await db.select({ id: paymentPersons.id }).from(paymentPersons).where(eq(paymentPersons.inviteCode, inviterCode)).limit(1);
    const inv = invRows[0];
    if (!inv) {
      const e = new Error("invalid_invite_code");
      (e as any).status = 400;
      throw e;
    }
    inviterPersonId = String(inv.id);
  }

  // 6 chars, alnum. Use 3 random bytes => 6 hex chars.
  const makeInviteCode = async (): Promise<string> => {
    for (let i = 0; i < 12; i++) {
      const c = crypto.randomBytes(3).toString("hex").toUpperCase();
      const exists = await db.select({ id: paymentPersons.id }).from(paymentPersons).where(eq(paymentPersons.inviteCode, c)).limit(1);
      if (!exists.length) return c;
    }
    const e = new Error("invite_code_generate_failed");
    (e as any).status = 500;
    throw e;
  };
  const inviteCode = await makeInviteCode();

  await db.insert(paymentPersons).values({
    id: personId,
    userId,
    name: input.name,
    balance: input.balance ?? "0.00",
    enabled: true,
    inviteCode,
    inviterPersonId,
    createdAtMs: now,
    updatedAtMs: now,
  } as any);

  // Record initial balance as a log entry for auditability.
  const init = input.balance ?? "0.00";
  if (init && init !== "0.00") {
    await db
      .insert(paymentPersonBalanceLogs)
      .values({
        id: id("ppl"),
        personId,
        delta: init,
        balanceAfter: init,
        reason: "初始余额",
        refType: "init",
        refId: personId,
        createdAtMs: now,
      } as any)
      .onConflictDoNothing();
  }

  return { id: personId, userId, username, password, inviteCode, inviterPersonId };
}

export async function adjustPaymentPersonBalance(input: {
  personId: string;
  delta: string;
  reason: string;
  refType?: string;
  refId?: string;
}): Promise<{ ok: boolean; balanceAfter?: string; error?: "not_found" | "insufficient_balance" }> {
  const p = await getPaymentPerson(input.personId);
  if (!p) return { ok: false, error: "not_found" };

  const after = money2(dec(p.balance).add(dec(input.delta)));
  if (dec(after).lt(0)) return { ok: false, error: "insufficient_balance" };
  await db.update(paymentPersons).set({ balance: after, updatedAtMs: Date.now() } as any).where(eq(paymentPersons.id, p.id));

  // refType+refId are optional; when provided they must be idempotent per person.
  await db
    .insert(paymentPersonBalanceLogs)
    .values({
      id: id("ppl"),
      personId: p.id,
      delta: input.delta,
      balanceAfter: after,
      reason: input.reason,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      createdAtMs: Date.now(),
    } as any)
    .onConflictDoNothing();

  return { ok: true, balanceAfter: after };
}

export async function creditPaymentPersonOnce(input: {
  personId: string;
  amount: string;
  reason: string;
  refType: string;
  refId: string;
}): Promise<{ ok: boolean; balanceAfter?: string }> {
  // If already credited for (person, refType, refId), do nothing.
  const exists = await db
    .select()
    .from(paymentPersonBalanceLogs)
    .where(and(eq(paymentPersonBalanceLogs.personId, input.personId), eq(paymentPersonBalanceLogs.refType, input.refType), eq(paymentPersonBalanceLogs.refId, input.refId)))
    .limit(1);
  if (exists.length) {
    const p = await getPaymentPerson(input.personId);
    return { ok: true, balanceAfter: p?.balance };
  }
  return await adjustPaymentPersonBalance({
    personId: input.personId,
    delta: input.amount,
    reason: input.reason,
    refType: input.refType,
    refId: input.refId,
  });
}

export async function pickPaymentPersonForAmount(amount: string): Promise<PaymentPersonRow | null> {
  const persons = await db.select().from(paymentPersons).where(eq(paymentPersons.enabled, true)).orderBy(desc(paymentPersons.updatedAtMs));
  const want = dec(amount);
  for (const p of persons) {
    if (dec(p.balance).gte(want)) return p;
  }
  return null;
}
