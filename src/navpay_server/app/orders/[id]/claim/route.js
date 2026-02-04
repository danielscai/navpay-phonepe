import { claimOrder, refreshExpiredClaims, verifyToken } from "../../../../lib/store.js";

export const runtime = "nodejs";

export async function POST(req, { params }) {
  refreshExpiredClaims();
  const auth = req.headers.get("authorization");
  const result = verifyToken(auth);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 401 });
  }
  const outcome = claimOrder(params.id, result.username);
  if (!outcome.ok) {
    const status = outcome.error === "order_not_found" ? 404 : 409;
    return Response.json({ error: outcome.error }, { status });
  }
  return Response.json({ ok: true, order: outcome.order });
}
