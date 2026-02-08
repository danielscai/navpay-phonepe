import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { bankAccounts, paymentPersons, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "payout.channel.read");
  const rows = await db
    .select({
      id: bankAccounts.id,
      personId: bankAccounts.personId,
      personName: paymentPersons.name,
      username: users.username,
      bankName: bankAccounts.bankName,
      alias: bankAccounts.alias,
      accountLast4: bankAccounts.accountLast4,
      ifsc: bankAccounts.ifsc,
      enabled: bankAccounts.enabled,
      createdAtMs: bankAccounts.createdAtMs,
      updatedAtMs: bankAccounts.updatedAtMs,
    })
    .from(bankAccounts)
    .leftJoin(paymentPersons, eq(paymentPersons.id, bankAccounts.personId))
    .leftJoin(users, eq(users.id, paymentPersons.userId))
    .orderBy(desc(bankAccounts.updatedAtMs))
    .limit(200);
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  // Accounts are registered by clients, not manually created in admin.
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
