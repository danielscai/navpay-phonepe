import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { webhookEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";
import { env } from "@/lib/env";

export async function GET(req: NextRequest, ctx: { params: Promise<{ receiverId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await requireApiPerm(req, "tools.debug");
  const { receiverId } = await ctx.params;
  const rows = await db.select().from(webhookEvents).where(eq(webhookEvents.receiverId, receiverId));
  // latest first
  rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return NextResponse.json({ ok: true, rows: rows.slice(0, 50) });
}
