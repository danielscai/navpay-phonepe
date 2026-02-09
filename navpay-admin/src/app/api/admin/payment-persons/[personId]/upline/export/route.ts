import { NextResponse, type NextRequest } from "next/server";
import { requireApiPerm } from "@/lib/api";
import { getUplineChain } from "@/lib/payment-person-stats";

function csvEscape(s: string): string {
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) return `"${s.replace(/\"/g, '""')}"`;
  return s;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ personId: string }> }) {
  await requireApiPerm(req, "payout.channel.read");
  const { personId } = await ctx.params;
  const chain = await getUplineChain({ personId, maxDepth: 3 });
  const header = ["level", "id", "username", "name", "invite_code"];
  const lines = [header.join(",")];
  chain.forEach((c, i) => {
    lines.push([String(i + 1), c.id, c.username ?? "", c.name ?? "", c.inviteCode ?? ""].map((x) => csvEscape(String(x ?? ""))).join(","));
  });
  const csv = lines.join("\n") + "\n";
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="upline_${personId}.csv"`,
      "cache-control": "no-store",
    },
  });
}

