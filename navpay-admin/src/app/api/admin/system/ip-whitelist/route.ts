import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { ipWhitelist } from "@/db/schema";
import { id } from "@/lib/id";
import { requireApiPerm } from "@/lib/api";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  ip: z.string().min(3).max(80),
  note: z.string().max(200).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "system.read");
  const rows = await db.select().from(ipWhitelist);
  rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  const { uid } = await requireApiPerm(req, "system.write");
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const rowId = id("ipw");
  await db.insert(ipWhitelist).values({
    id: rowId,
    ip: body.data.ip.trim(),
    note: body.data.note,
    enabled: body.data.enabled ?? true,
    createdAtMs: Date.now(),
  });

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.ip_whitelist_add",
    entityType: "ip_whitelist",
    entityId: rowId,
    meta: { ip: body.data.ip.trim(), enabled: body.data.enabled ?? true },
  });

  return NextResponse.json({ ok: true, id: rowId });
}

