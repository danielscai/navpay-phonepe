import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { webhookEvents, webhookReceivers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ receiverId: string }> }) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { uid } = await requireApiPerm(req, "tools.debug");
  const { receiverId } = await ctx.params;

  await db.delete(webhookEvents).where(eq(webhookEvents.receiverId, receiverId));
  await db.delete(webhookReceivers).where(eq(webhookReceivers.id, receiverId));

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "tools.webhook_receiver_delete",
    entityType: "webhook_receiver",
    entityId: receiverId,
    meta: {},
  });

  return NextResponse.json({ ok: true });
}

