import { NextResponse, type NextRequest } from "next/server";
import { revokePersonalToken } from "@/lib/personal-auth";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const token = m[1].trim();
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;
  const out = await revokePersonalToken({ token, ip, userAgent });
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

