import { getUser, refreshExpiredClaims, updateUser, verifyToken } from "../../lib/store.js";

export const runtime = "nodejs";

export async function GET(req) {
  refreshExpiredClaims();
  const auth = req.headers.get("authorization");
  const result = verifyToken(auth);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 401 });
  }
  const user = getUser(result.username);
  return Response.json({ username: user.username, name: user.name, phone: user.phone, email: user.email });
}

export async function PUT(req) {
  refreshExpiredClaims();
  const auth = req.headers.get("authorization");
  const result = verifyToken(auth);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const user = updateUser(result.username, body || {});
  return Response.json({ username: user.username, name: user.name, phone: user.phone, email: user.email });
}
