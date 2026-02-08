import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { callbackTasks } from "@/db/schema";
import { requireApiPerm } from "@/lib/api";

export async function GET(req: NextRequest) {
  await requireApiPerm(req, "callback.read");
  const rows = await db.select().from(callbackTasks);
  rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
  return NextResponse.json({ ok: true, rows: rows.slice(0, 200) });
}

