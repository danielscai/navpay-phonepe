import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { merchantLimitRules, merchants, merchantFees, users } from "@/db/schema";
import { id } from "@/lib/id";
import { requireApiPerm } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { createMerchantApiKey } from "@/lib/merchant-keys";
import { hashPassword } from "@/lib/password";
import { randomStrongPassword } from "@/lib/password-gen";
import { isRechargeConfigured } from "@/lib/recharge-hd";
import { ensureMerchantDepositAddress } from "@/lib/recharge-address";

const createSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  merchantUsername: z.string().min(2).max(64).optional(),
});

const querySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(10),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "merchant.read");
  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: u.searchParams.get("q") ?? undefined,
    page: u.searchParams.get("page") ?? undefined,
    pageSize: u.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const conds: any[] = [];
  const q = parsed.data.q?.trim();
  if (q) conds.push(or(like(merchants.code, `%${q}%`), like(merchants.name, `%${q}%`)));
  const where = conds.length ? and(...conds) : undefined;

  const totalRow = await db
    .select({ c: sql<number>`count(*)` })
    .from(merchants)
    .where(where as any);
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const rows = await db
    .select()
    .from(merchants)
    .where(where as any)
    .orderBy(desc(merchants.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  return NextResponse.json({ ok: true, page: parsed.data.page, pageSize: parsed.data.pageSize, total, rows });
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

  // Limit rules: exactly one row per type (collect/payout), editable only.
  await db.insert(merchantLimitRules).values([
    {
      id: id("mlr"),
      merchantId,
      type: "collect",
      minAmount: "0",
      maxAmount: "0",
      dailyCountLimit: 0,
      enabled: true,
      note: null,
      createdAtMs: Date.now(),
    } as any,
    {
      id: id("mlr"),
      merchantId,
      type: "payout",
      minAmount: "0",
      maxAmount: "0",
      dailyCountLimit: 0,
      enabled: true,
      note: null,
      createdAtMs: Date.now(),
    } as any,
  ]);

  const apiKey = await createMerchantApiKey(merchantId);

  // Create merchant portal user (no RBAC). First login must enroll 2FA.
  const merchantUsername = (body.data.merchantUsername?.trim() || body.data.code.trim()).slice(0, 64);
  const existing = await db.select().from(users).where(eq(users.username, merchantUsername)).limit(1);
  if (existing.length) {
    return NextResponse.json({ ok: false, error: "duplicate_merchant_username" }, { status: 409 });
  }

  const password = randomStrongPassword();
  const passwordHash = await hashPassword(password);
  const merchantUserId = id("user");
  await db.insert(users).values({
    id: merchantUserId,
    username: merchantUsername,
    email: null,
    displayName: `${body.data.name} 商户`,
    merchantId,
    passwordHash,
    passwordUpdatedAtMs: Date.now(),
    totpEnabled: false,
    totpMustEnroll: true,
    failedLoginCount: 0,
    lockUntilMs: null as any,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  } as any);

  await writeAuditLog({
    req,
    actorUserId: uid,
    merchantId,
    action: "merchant.create",
    entityType: "merchant",
    entityId: merchantId,
    meta: { code: body.data.code, name: body.data.name, merchantUsername },
  });

  // Best-effort: allocate deposit addresses (one per chain) at merchant creation.
  // If HD wallet is not configured, addresses can still be allocated later when configured.
  if (isRechargeConfigured()) {
    try { await ensureMerchantDepositAddress({ merchantId, chain: "tron" }); } catch {}
    try { await ensureMerchantDepositAddress({ merchantId, chain: "bsc" }); } catch {}
  }

  return NextResponse.json({ ok: true, id: merchantId, apiKey, merchantUser: { username: merchantUsername, password } });
}
