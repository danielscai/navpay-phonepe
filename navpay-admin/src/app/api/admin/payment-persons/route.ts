import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireApiPerm } from "@/lib/api";
import { createPaymentPersonWithUser, listPaymentPersons } from "@/lib/payment-person";
import { db } from "@/lib/db";
import { paymentPersons, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

const createSchema = z.object({
  name: z.string().trim().min(1).max(60),
  balance: z.string().trim().min(1).max(32).optional(),
  username: z.string().trim().min(1).max(60).optional(),
  password: z.string().trim().min(1).max(200).optional(),
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
      createdAtMs: paymentPersons.createdAtMs,
      updatedAtMs: paymentPersons.updatedAtMs,
    })
    .from(paymentPersons)
    .leftJoin(users, eq(users.id, paymentPersons.userId))
    .orderBy(desc(paymentPersons.createdAtMs));
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  await requireApiPerm(req, "payout.channel.write");
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  try {
    const out = await createPaymentPersonWithUser({
      name: body.data.name,
      balance: body.data.balance,
      username: body.data.username,
      password: body.data.password,
    });
    // Password is returned once for admin to deliver to the payment person.
    return NextResponse.json({ ok: true, id: out.id, userId: out.userId, username: out.username, password: out.password });
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    if (msg === "username_taken") return NextResponse.json({ ok: false, error: "username_taken" }, { status: 409 });
    if (msg.includes("密码")) return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    return NextResponse.json({ ok: false, error: "create_failed" }, { status: 400 });
  }
}
