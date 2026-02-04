import { getEarnings, refreshExpiredClaims, verifyToken } from "../../lib/store.js";

export const runtime = "nodejs";

export async function GET(req) {
  refreshExpiredClaims();
  const auth = req.headers.get("authorization");
  const result = verifyToken(auth);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 401 });
  }
  const payload = getEarnings(result.username);
  return Response.json(payload || { total: 0, earnings: [] });
}
