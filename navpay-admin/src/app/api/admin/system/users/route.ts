import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { roles, userRoles, users } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { and, asc, desc, eq, isNull, like, or, sql } from "drizzle-orm";
import { id } from "@/lib/id";
import { hashPassword, validateStrongPassword } from "@/lib/password";
import { randomStrongPassword } from "@/lib/password-gen";
import { writeAuditLog } from "@/lib/audit";

const querySchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(200).default(20),
});

const createSchema = z.object({
  username: z.string().min(2).max(64),
  displayName: z.string().min(1).max(64),
  email: z.string().email().optional().or(z.literal("")),
  password: z.string().optional().or(z.literal("")),
  roleIds: z.array(z.string().min(1)).default([]),
  totpMustEnroll: z.coerce.boolean().default(true),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "system.read");
  const u = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: u.searchParams.get("q") ?? undefined,
    page: u.searchParams.get("page") ?? undefined,
    pageSize: u.searchParams.get("pageSize") ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const conds: any[] = [isNull(users.merchantId)];
  const q = parsed.data.q?.trim();
  if (q) conds.push(or(like(users.username, `%${q}%`), like(users.displayName, `%${q}%`), like(users.email, `%${q}%`)));
  const where = and(...conds);

  const totalRow = await db.select({ c: sql<number>`count(*)` }).from(users).where(where as any);
  const total = Number((totalRow[0] as any)?.c ?? 0);

  const offset = (parsed.data.page - 1) * parsed.data.pageSize;
  const userRows = await db
    .select({ id: users.id, username: users.username, email: users.email, displayName: users.displayName, totpEnabled: users.totpEnabled, totpMustEnroll: users.totpMustEnroll, createdAtMs: users.createdAtMs, updatedAtMs: users.updatedAtMs })
    .from(users)
    .where(where as any)
    .orderBy(desc(users.createdAtMs))
    .limit(parsed.data.pageSize)
    .offset(offset);

  const rRows = await db.select().from(roles).orderBy(asc(roles.name));
  const ur = await db.select().from(userRoles);
  const rolesById = new Map(rRows.map((r) => [r.id, r]));
  const roleIdsByUserId = new Map<string, string[]>();
  for (const x of ur) {
    const list = roleIdsByUserId.get(x.userId) ?? [];
    list.push(x.roleId);
    roleIdsByUserId.set(x.userId, list);
  }

  return NextResponse.json({
    ok: true,
    page: parsed.data.page,
    pageSize: parsed.data.pageSize,
    total,
    roles: rRows,
    users: userRows.map((u) => ({
      ...u,
      roleIds: (roleIdsByUserId.get(u.id) ?? []).filter((rid) => rolesById.has(rid)),
    })),
  });
}

export async function POST(req: NextRequest) {
  const { uid } = await requireApiPerm(req, "system.write");
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const password = body.data.password?.trim() ? body.data.password.trim() : randomStrongPassword();
  const strong = validateStrongPassword(password);
  if (!strong.ok) return NextResponse.json({ ok: false, error: strong.reason || "weak_password" }, { status: 400 });

  const passwordHash = await hashPassword(password);
  const userId = id("user");
  await db.insert(users).values({
    id: userId,
    username: body.data.username.trim(),
    email: body.data.email?.trim() ? body.data.email.trim() : null,
    displayName: body.data.displayName.trim(),
    merchantId: null,
    passwordHash,
    passwordUpdatedAtMs: Date.now(),
    totpEnabled: false,
    totpMustEnroll: body.data.totpMustEnroll,
    failedLoginCount: 0,
    lockUntilMs: null as any,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
  } as any);

  for (const rid of body.data.roleIds) {
    await db.insert(userRoles).values({ userId, roleId: rid }).onConflictDoNothing();
  }

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.user_create",
    entityType: "user",
    entityId: userId,
    meta: { username: body.data.username, displayName: body.data.displayName, roleIds: body.data.roleIds },
  });

  return NextResponse.json({ ok: true, id: userId, password });
}
