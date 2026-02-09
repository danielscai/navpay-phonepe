import { NextResponse, type NextRequest } from "next/server";
import { requirePersonalToken } from "@/lib/personal-auth";
import { db } from "@/lib/db";
import { paymentPersons, users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { personId } = await requirePersonalToken(req as any);
  const rows = await db
    .select({
      id: paymentPersons.id,
      name: paymentPersons.name,
      balance: paymentPersons.balance,
      enabled: paymentPersons.enabled,
      username: users.username,
    })
    .from(paymentPersons)
    .leftJoin(users, eq(users.id, paymentPersons.userId))
    .where(eq(paymentPersons.id, personId))
    .limit(1);
  const me = rows[0];
  if (!me) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, me });
}

