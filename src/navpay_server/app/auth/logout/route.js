import { refreshExpiredClaims, revokeToken, verifyToken } from "../../../lib/store.js";

export const runtime = "nodejs";

export async function POST(req) {
  refreshExpiredClaims();
  const auth = req.headers.get("authorization");
  const result = verifyToken(auth);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 401 });
  }
  revokeToken(result.token);
  return Response.json({ ok: true });
}
