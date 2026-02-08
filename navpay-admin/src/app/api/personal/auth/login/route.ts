import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { issuePersonalToken } from "@/lib/personal-auth";

const schema = z.object({
  username: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const body = schema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;
  const out = await issuePersonalToken({ username: body.data.username, password: body.data.password, ip, userAgent });
  if (!out.ok) return NextResponse.json({ ok: false, error: out.error }, { status: 401 });
  return NextResponse.json({ ok: true, token: out.token, person: out.person });
}

