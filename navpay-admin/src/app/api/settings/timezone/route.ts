import { NextResponse, type NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api";
import { TIMEZONE_COOKIE, isAllowedTimezone } from "@/lib/timezone";

export async function POST(req: NextRequest) {
  await requireApiUser(req); // includes CSRF for POST by default
  const body = await req.json().catch(() => null);
  const tz = String(body?.timezone ?? "");
  if (!isAllowedTimezone(tz)) {
    return NextResponse.json({ ok: false, error: "invalid_timezone" }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, timezone: tz });
  res.cookies.set(TIMEZONE_COOKIE, tz, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

