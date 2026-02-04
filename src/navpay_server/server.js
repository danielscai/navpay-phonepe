import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "1mb" }));

const TOKEN_TTL_MS = 1000 * 60 * 30; // 30 minutes

const users = new Map([
  ["alice", {
    username: "alice",
    password: "alice123",
    name: "Alice Chen",
    phone: "+91-90000-00001",
    email: "alice@example.com",
    orders: [
      { id: "ORD-1001", amount: 1299.0, currency: "INR", status: "PAID", createdAt: "2026-02-01T10:12:00Z" },
      { id: "ORD-1002", amount: 499.0, currency: "INR", status: "REFUNDED", createdAt: "2026-02-02T08:05:00Z" }
    ],
    earnings: [
      { id: "EARN-7001", amount: 88.5, currency: "INR", note: "Referral bonus", createdAt: "2026-02-01T12:00:00Z" },
      { id: "EARN-7002", amount: 120.0, currency: "INR", note: "Cashback", createdAt: "2026-02-03T12:20:00Z" }
    ]
  }],
  ["bob", {
    username: "bob",
    password: "bob123",
    name: "Bob Singh",
    phone: "+91-90000-00002",
    email: "bob@example.com",
    orders: [
      { id: "ORD-2001", amount: 250.0, currency: "INR", status: "PAID", createdAt: "2026-01-30T15:30:00Z" }
    ],
    earnings: [
      { id: "EARN-8001", amount: 60.0, currency: "INR", note: "Cashback", createdAt: "2026-02-02T09:10:00Z" }
    ]
  }]
]);

const tokens = new Map();

function issueToken(username) {
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  tokens.set(token, { username, expiresAt });
  return { token, expiresAt };
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || "";
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return res.status(401).json({ error: "missing_token" });
  }
  const token = parts[1];
  const entry = tokens.get(token);
  if (!entry) {
    return res.status(401).json({ error: "invalid_token" });
  }
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return res.status(401).json({ error: "token_expired" });
  }
  req.user = entry.username;
  next();
}

app.get("/health", (req, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "missing_credentials" });
  }
  const user = users.get(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "invalid_credentials" });
  }
  const { token, expiresAt } = issueToken(username);
  res.json({ token, expiresAt, user: { username, name: user.name, phone: user.phone, email: user.email } });
});

app.post("/auth/logout", authMiddleware, (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.split(" ")[1];
  tokens.delete(token);
  res.json({ ok: true });
});

app.get("/me", authMiddleware, (req, res) => {
  const user = users.get(req.user);
  res.json({ username: user.username, name: user.name, phone: user.phone, email: user.email });
});

app.put("/me", authMiddleware, (req, res) => {
  const user = users.get(req.user);
  const { name, phone, email } = req.body || {};
  if (typeof name === "string") user.name = name;
  if (typeof phone === "string") user.phone = phone;
  if (typeof email === "string") user.email = email;
  res.json({ username: user.username, name: user.name, phone: user.phone, email: user.email });
});

app.get("/orders", authMiddleware, (req, res) => {
  const user = users.get(req.user);
  res.json({ orders: user.orders });
});

app.get("/earnings", authMiddleware, (req, res) => {
  const user = users.get(req.user);
  const total = user.earnings.reduce((sum, e) => sum + e.amount, 0);
  res.json({ total, earnings: user.earnings });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`NavPay server running on http://127.0.0.1:${port}`);
});
