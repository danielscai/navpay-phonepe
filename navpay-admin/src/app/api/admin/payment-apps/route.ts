import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { paymentApps } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { desc, eq } from "drizzle-orm";
import { id } from "@/lib/id";
import { writeAuditLog } from "@/lib/audit";

const createSchema = z.object({
  name: z.string().min(2),
  packageName: z.string().min(2),
  versionCode: z.coerce.number().int().min(1).default(1),
  downloadUrl: z.string().min(4),
  iconUrl: z.string().url().optional().or(z.literal("")),
  minSupportedVersionCode: z.coerce.number().int().min(0).default(0),
  payoutEnabled: z.coerce.boolean().default(true),
  collectEnabled: z.coerce.boolean().default(true),
  promoted: z.coerce.boolean().default(false),
  enabled: z.coerce.boolean().default(true),
});

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "system.read");
  const rows = await db.select().from(paymentApps).orderBy(desc(paymentApps.createdAtMs));
  return NextResponse.json({ ok: true, rows });
}

export async function POST(req: NextRequest) {
  const { uid } = await requireApiPerm(req, "system.write");
  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });

  const appId = id("papp");
  await db.insert(paymentApps).values({
    id: appId,
    name: body.data.name,
    packageName: body.data.packageName,
    versionCode: body.data.versionCode,
    downloadUrl: body.data.downloadUrl,
    iconUrl: body.data.iconUrl?.trim() ? body.data.iconUrl.trim() : null,
    minSupportedVersionCode: body.data.minSupportedVersionCode,
    payoutEnabled: body.data.payoutEnabled,
    collectEnabled: body.data.collectEnabled,
    promoted: body.data.promoted,
    enabled: body.data.enabled,
    createdAtMs: Date.now(),
  } as any);

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "system.payment_app_create",
    entityType: "payment_app",
    entityId: appId,
    meta: { ...body.data },
  });

  const row = await db.select().from(paymentApps).where(eq(paymentApps.id, appId)).limit(1);
  return NextResponse.json({ ok: true, row: row[0] });
}

