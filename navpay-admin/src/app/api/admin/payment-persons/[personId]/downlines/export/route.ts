import { NextResponse, type NextRequest } from "next/server";
import { requireApiPerm } from "@/lib/api";
import { db } from "@/lib/db";
import { paymentPersons, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

function csvEscape(s: string): string {
  // RFC4180-ish
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/\"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ personId: string }> }) {
  await requireApiPerm(req, "payout.channel.read");
  const { personId } = await ctx.params;

  const rows = await db
    .select({
      id: paymentPersons.id,
      username: users.username,
      name: paymentPersons.name,
      enabled: paymentPersons.enabled,
      balance: paymentPersons.balance,
      inviteCode: paymentPersons.inviteCode,
      createdAtMs: paymentPersons.createdAtMs,
      updatedAtMs: paymentPersons.updatedAtMs,
    })
    .from(paymentPersons)
    .leftJoin(users, eq(users.id, paymentPersons.userId))
    .where(eq(paymentPersons.inviterPersonId, personId))
    .orderBy(desc(paymentPersons.createdAtMs))
    .limit(5000);

  const header = ["id", "username", "name", "enabled", "balance", "invite_code", "created_at_ms", "updated_at_ms"];
  const lines = [header.join(",")];
  for (const r of rows as any[]) {
    const row = [
      String(r.id ?? ""),
      String(r.username ?? ""),
      String(r.name ?? ""),
      String(r.enabled ? "1" : "0"),
      String(r.balance ?? ""),
      String(r.inviteCode ?? ""),
      String(r.createdAtMs ?? ""),
      String(r.updatedAtMs ?? ""),
    ].map(csvEscape);
    lines.push(row.join(","));
  }
  const csv = lines.join("\n") + "\n";

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="downlines_${personId}.csv"`,
      "cache-control": "no-store",
    },
  });
}

