import { formatOrder, getOpenOrders, refreshExpiredClaims, verifyToken } from "../../../lib/store.js";

export const runtime = "nodejs";

export async function GET(req) {
  refreshExpiredClaims();
  const auth = req.headers.get("authorization");
  const result = verifyToken(auth);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 401 });
  }
  const orders = getOpenOrders().map(formatOrder);
  return Response.json({ orders });
}
