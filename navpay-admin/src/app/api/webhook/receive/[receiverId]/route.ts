import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { webhookEvents } from "@/db/schema";
import { id } from "@/lib/id";

export async function POST(req: Request, ctx: { params: Promise<{ receiverId: string }> }) {
  const { receiverId } = await ctx.params;
  const headersObj: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headersObj[k] = v;
  });
  const body = await req.text();
  await db.insert(webhookEvents).values({
    id: id("wev"),
    receiverId,
    headersJson: JSON.stringify(headersObj),
    body,
    createdAtMs: Date.now(),
  });
  return NextResponse.json({ ok: true });
}

