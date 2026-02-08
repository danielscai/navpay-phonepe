import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api";
import { db } from "@/lib/db";
import { webauthnCredentials } from "@/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { uid } = await requireApiUser(req, { csrf: false });
  const rows = await db
    .select({
      id: webauthnCredentials.id,
      deviceName: webauthnCredentials.deviceName,
      createdAtMs: webauthnCredentials.createdAtMs,
      lastUsedAtMs: webauthnCredentials.lastUsedAtMs,
      revokedAtMs: webauthnCredentials.revokedAtMs,
    })
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, uid), isNull(webauthnCredentials.revokedAtMs)))
    .orderBy(desc(webauthnCredentials.createdAtMs));

  return NextResponse.json({ ok: true, passkeys: rows });
}

