import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { paymentDevices } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";

const schema = z.object({
  online: z.boolean(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ deviceId: string }> }) {
  await requireApiPerm(req, "payout.channel.write");
  const { deviceId } = await ctx.params;
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const now = Date.now();
  await db
    .update(paymentDevices)
    .set({
      online: body.data.online,
      lastSeenAtMs: body.data.online ? now : null,
      updatedAtMs: now,
    } as any)
    .where(eq(paymentDevices.id, deviceId));
  return NextResponse.json({ ok: true });
}

