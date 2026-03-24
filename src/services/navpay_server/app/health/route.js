import { refreshExpiredClaims } from "../../lib/store.js";

export const runtime = "nodejs";

export async function GET() {
  refreshExpiredClaims();
  return Response.json({ ok: true, now: new Date().toISOString() });
}
