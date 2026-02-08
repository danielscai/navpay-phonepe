import { NextResponse } from "next/server";
import { CSRF_COOKIE, newCsrfToken } from "@/lib/csrf";

export async function GET() {
  const token = newCsrfToken();
  const res = NextResponse.json({ ok: true, token });
  // Double-submit cookie: readable by client JS (not HttpOnly) so it can echo in header.
  res.cookies.set({
    name: CSRF_COOKIE,
    value: token,
    httpOnly: false,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 60 * 60,
  });
  return res;
}

