import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiPerm } from "@/lib/api";
import { createPaymentPersonWithUser } from "@/lib/payment-person";
import { db } from "@/lib/db";
import { paymentPersons, users } from "@/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { getDirectDownlineCountByPersonIds, getLastLoginByPersonIds, getTodayOrderStatsByPersonIds, getTodayRebateStatsByPersonIds } from "@/lib/payment-person-stats";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  balance: z.string().trim().min(1).max(32).optional(),
  username: z.string().trim().min(1).max(60).optional(),
  password: z.string().trim().min(1).max(200).optional(),
  inviterCode: z.string().trim().min(1).max(20).optional(),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "payout.channel.read");
  const rows = await db
    .select({
      id: paymentPersons.id,
      userId: paymentPersons.userId,
      username: users.username,
      name: paymentPersons.name,
      balance: paymentPersons.balance,
      enabled: paymentPersons.enabled,
      inviteCode: paymentPersons.inviteCode,
      inviterPersonId: paymentPersons.inviterPersonId,
      createdAtMs: paymentPersons.createdAtMs,
      updatedAtMs: paymentPersons.updatedAtMs,
    })
    .from(paymentPersons)
    .leftJoin(users, eq(users.id, paymentPersons.userId))
    .orderBy(desc(paymentPersons.createdAtMs));

  const ids = (rows as any[]).map((r) => String(r.id));
  const nowMs = Date.now();
  const [downlineCount, lastLogin, todayOrders, todayRebates] = await Promise.all([
    getDirectDownlineCountByPersonIds(ids),
    getLastLoginByPersonIds(ids),
    getTodayOrderStatsByPersonIds({ personIds: ids, nowMs }),
    getTodayRebateStatsByPersonIds({ personIds: ids, nowMs }),
  ]);

  const inviterIds = Array.from(new Set((rows as any[]).map((r) => String(r.inviterPersonId ?? "")).filter(Boolean)));
  const inviterMap = new Map<string, { id: string; name: string; username: string | null; inviteCode: string | null }>();
  if (inviterIds.length) {
    const invRows = await db
      .select({
        id: paymentPersons.id,
        name: paymentPersons.name,
        inviteCode: paymentPersons.inviteCode,
        username: users.username,
      })
      .from(paymentPersons)
      .leftJoin(users, eq(users.id, paymentPersons.userId))
      .where(inArray(paymentPersons.id, inviterIds as any));
    for (const ir of invRows as any[]) {
      inviterMap.set(String(ir.id), {
        id: String(ir.id),
        name: String(ir.name),
        username: ir.username ? String(ir.username) : null,
        inviteCode: ir.inviteCode ? String(ir.inviteCode) : null,
      });
    }
  }

  const merged = (rows as any[]).map((r) => {
    const pid = String(r.id);
    const invId = String(r.inviterPersonId ?? "");
    return {
      ...r,
      inviter: invId ? inviterMap.get(invId) ?? { id: invId, name: "-", username: null, inviteCode: null } : null,
      directDownlineCount: downlineCount[pid] ?? 0,
      lastLogin: lastLogin[pid] ?? null,
      todayOrders: todayOrders[pid] ?? null,
      todayRebates: todayRebates[pid] ?? null,
    };
  });

  return NextResponse.json({ ok: true, rows: merged });
}

export async function POST(req: NextRequest) {
  try {
    await requireApiPerm(req, "payout.channel.write");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? "forbidden") }, { status: Number(e?.status ?? 500) });
  }
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  try {
    const out = await createPaymentPersonWithUser({
      name: body.data.name,
      balance: body.data.balance,
      username: body.data.username,
      password: body.data.password,
      inviterCode: body.data.inviterCode,
    });
    // Password is returned once for admin to deliver to the payment person.
    return NextResponse.json({
      ok: true,
      id: out.id,
      userId: out.userId,
      username: out.username,
      password: out.password,
      inviteCode: out.inviteCode,
      inviterPersonId: out.inviterPersonId ?? null,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg === "username_taken") return NextResponse.json({ ok: false, error: "username_taken" }, { status: 409 });
    if (msg === "invalid_invite_code") return NextResponse.json({ ok: false, error: "invalid_invite_code" }, { status: 400 });
    if (msg.includes("密码")) return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 400 });
  }
}
