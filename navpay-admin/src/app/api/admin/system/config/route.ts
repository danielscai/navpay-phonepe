import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { systemConfigs } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit";

const upsertSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(0),
  description: z.string().optional(),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "system.read");
  const rows = await db.select().from(systemConfigs);
  rows.sort((a, b) => a.key.localeCompare(b.key));
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  const { uid } = await requireApiPerm(req, "system.write");
  const body = upsertSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const before = await db.select().from(systemConfigs).where(eq(systemConfigs.key, body.data.key)).limit(1);
  const prev = before[0] ?? null;

  await db
    .insert(systemConfigs)
    .values({
      key: body.data.key,
      value: body.data.value,
      description: body.data.description,
      updatedAtMs: Date.now(),
    })
    .onConflictDoUpdate({
      target: systemConfigs.key,
      set: { value: body.data.value, description: body.data.description, updatedAtMs: Date.now() },
    });

  const changes: Record<string, { from: any; to: any }> = {};
  if (prev?.value !== body.data.value) changes.value = { from: prev?.value ?? null, to: body.data.value };
  const prevDesc = prev?.description ?? null;
  const nextDesc = body.data.description ?? null;
  if (prevDesc !== nextDesc) changes.description = { from: prevDesc, to: nextDesc };

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.config_upsert",
    entityType: "system_config",
    entityId: body.data.key,
    meta: { changes },
  });

  const row = await db.select().from(systemConfigs).where(eq(systemConfigs.key, body.data.key)).limit(1);
  return NextResponse.json({ ok: true, row: row[0] });
}
