import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { paymentDevices, paymentPersons, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "payout.channel.read");
  const rows = await db
    .select({
      id: paymentDevices.id,
      personId: paymentDevices.personId,
      personName: paymentPersons.name,
      username: users.username,
      name: paymentDevices.name,
      online: paymentDevices.online,
      lastSeenAtMs: paymentDevices.lastSeenAtMs,
      createdAtMs: paymentDevices.createdAtMs,
      updatedAtMs: paymentDevices.updatedAtMs,
    })
    .from(paymentDevices)
    .leftJoin(paymentPersons, eq(paymentPersons.id, paymentDevices.personId))
    .leftJoin(users, eq(users.id, paymentPersons.userId))
    .orderBy(desc(paymentDevices.updatedAtMs))
    .limit(200);
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  // Devices are registered by clients, not manually created in admin.
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
