import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { permissions } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";
import { asc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "system.read");
  const rows = await db.select().from(permissions).orderBy(asc(permissions.key));
  return NextResponse.json({ ok: true, rows });
}

