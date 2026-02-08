import { NextResponse } from "next/server";

// Deprecated: the simulator now uses real personal login + /api/personal/report/sync.
export async function POST() {
  return NextResponse.json({ ok: false, error: "gone" }, { status: 410 });
}
