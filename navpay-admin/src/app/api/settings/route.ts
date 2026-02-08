import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { TIMEZONE_COOKIE, isAllowedTimezone } from "@/lib/timezone";

export async function GET() {
  const c = await cookies();
  const tzCookie = c.get(TIMEZONE_COOKIE)?.value;
  const timezone = tzCookie && isAllowedTimezone(tzCookie) ? tzCookie : env.DEFAULT_TIMEZONE;
  return NextResponse.json({ ok: true, timezone });
}
