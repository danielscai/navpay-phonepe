import { issueToken, getUser, refreshExpiredClaims } from "../../../lib/store.js";

export const runtime = "nodejs";

export async function POST(req) {
  refreshExpiredClaims();
  const body = await req.json().catch(() => null);
  const { username, password } = body || {};
  if (!username || !password) {
    return Response.json({ error: "missing_credentials" }, { status: 400 });
  }
  const user = getUser(username);
  if (!user || user.password !== password) {
    return Response.json({ error: "invalid_credentials" }, { status: 401 });
  }
  const { token, expiresAt } = issueToken(username);
  return Response.json({
    token,
    expiresAt,
    user: { username: user.username, name: user.name, phone: user.phone, email: user.email }
  });
}
