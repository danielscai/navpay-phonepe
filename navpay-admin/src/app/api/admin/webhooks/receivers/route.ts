import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { webhookReceivers } from "@/db/schema";
import { id } from "@/lib/id";
import { requireApiPerm } from "@/lib/api";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().min(1),
});

export async function GET(req: NextRequest) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  await requireApiPerm(req, "tools.debug");
  const rows = await db.select().from(webhookReceivers);
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { uid } = await requireApiPerm(req, "tools.debug");
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const receiverId = id("wh");
  await db.insert(webhookReceivers).values({ id: receiverId, name: body.data.name, createdAtMs: Date.now() });

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "tools.webhook_receiver_create",
    entityType: "webhook_receiver",
    entityId: receiverId,
    meta: { name: body.data.name },
  });

  return NextResponse.json({ ok: true, id: receiverId });
}
