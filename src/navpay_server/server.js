import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "1mb" }));

const TOKEN_TTL_MS = 1000 * 60 * 30; // 30 minutes
const CLAIM_TTL_MS = 1000 * 60 * 5; // 5 minutes

const users = new Map([
  ["alice", {
    username: "alice",
    password: "alice123",
    name: "Alice Chen",
    phone: "+91-90000-00001",
    email: "alice@example.com",
    earnings: [
      { id: "EARN-7001", amount: 88.5, currency: "INR", note: "Referral bonus", createdAt: "2026-02-01T12:00:00Z" },
      { id: "EARN-7002", amount: 120.0, currency: "INR", note: "Cashback", createdAt: "2026-02-03T12:20:00Z" }
    ],
    claimFailures: []
  }],
  ["bob", {
    username: "bob",
    password: "bob123",
    name: "Bob Singh",
    phone: "+91-90000-00002",
    email: "bob@example.com",
    earnings: [
      { id: "EARN-8001", amount: 60.0, currency: "INR", note: "Cashback", createdAt: "2026-02-02T09:10:00Z" }
    ],
    claimFailures: []
  }]
]);

const orders = [
  { id: "ORD-1001", amount: 1299.0, currency: "INR", status: "PAID", createdAt: "2026-02-01T10:12:00Z", paymentApp: "PE", assignedTo: "alice", claimedAt: null, claimExpiresAt: null },
  { id: "ORD-1002", amount: 499.0, currency: "INR", status: "REFUNDED", createdAt: "2026-02-02T08:05:00Z", paymentApp: "PE", assignedTo: "alice", claimedAt: null, claimExpiresAt: null },
  { id: "ORD-2001", amount: 250.0, currency: "INR", status: "PAID", createdAt: "2026-01-30T15:30:00Z", paymentApp: "PE", assignedTo: "bob", claimedAt: null, claimExpiresAt: null },
  { id: "ORD-3001", amount: 699.0, currency: "INR", status: "UNASSIGNED", createdAt: "2026-02-03T07:20:00Z", paymentApp: "PE", assignedTo: null, claimedAt: null, claimExpiresAt: null },
  { id: "ORD-3002", amount: 199.0, currency: "INR", status: "UNASSIGNED", createdAt: "2026-02-03T11:45:00Z", paymentApp: "PE", assignedTo: null, claimedAt: null, claimExpiresAt: null },
  { id: "ORD-4001", amount: 999.0, currency: "INR", status: "PENDING_PAYMENT", createdAt: "2026-02-03T12:10:00Z", paymentApp: "PE", assignedTo: "bob", claimedAt: "2026-02-03T12:10:00Z", claimExpiresAt: null }
];

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

function refreshExpiredClaims() {
  const now = Date.now();
  for (const order of orders) {
    if (order.status === "CLAIMED" && order.claimExpiresAt && now > order.claimExpiresAt) {
      const user = order.assignedTo ? users.get(order.assignedTo) : null;
      if (user) {
        user.claimFailures.push({
          orderId: order.id,
          claimedAt: order.claimedAt,
          releasedAt: new Date(now).toISOString()
        });
      }
      order.status = "UNASSIGNED";
      order.assignedTo = null;
      order.claimedAt = null;
      order.claimExpiresAt = null;
    }
  }
}

function formatOrder(order) {
  return {
    id: order.id,
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    createdAt: order.createdAt,
    paymentApp: order.paymentApp,
    assignedTo: order.assignedTo,
    claimedAt: order.claimedAt,
    claimExpiresAt: order.claimExpiresAt
  };
}

app.use((req, res, next) => {
  refreshExpiredClaims();
  next();
});

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

app.get(["/orders", "/orders/my"], authMiddleware, (req, res) => {
  const userOrders = orders.filter((o) => o.assignedTo === req.user).map(formatOrder);
  res.json({ orders: userOrders });
});

app.get("/orders/open", authMiddleware, (req, res) => {
  const openOrders = orders.filter((o) => o.status === "UNASSIGNED").map(formatOrder);
  res.json({ orders: openOrders });
});

app.post("/orders/:id/claim", authMiddleware, (req, res) => {
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }
  if (order.status !== "UNASSIGNED") {
    return res.status(409).json({ error: "order_not_available" });
  }
  const now = Date.now();
  order.status = "CLAIMED";
  order.assignedTo = req.user;
  order.claimedAt = new Date(now).toISOString();
  order.claimExpiresAt = now + CLAIM_TTL_MS;
  res.json({ ok: true, order: formatOrder(order) });
});

app.get("/earnings", authMiddleware, (req, res) => {
  const user = users.get(req.user);
  const total = user.earnings.reduce((sum, e) => sum + e.amount, 0);
  res.json({ total, earnings: user.earnings });
});

function formatInIST(isoOrMillis) {
  if (!isoOrMillis) return "-";
  const date = typeof isoOrMillis === "number" ? new Date(isoOrMillis) : new Date(isoOrMillis);
  const fmt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  return fmt.format(date).replace(/\//g, "-");
}

function paginate(items, page, pageSize) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), totalPages);
  const start = (current - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    current,
    totalPages,
    total
  };
}

function renderLayout(title, active, content) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; color: #1a1a1a; background: #f7f8fb; }
    .layout { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
    .sidebar { background: #0f172a; color: #e2e8f0; padding: 20px; }
    .sidebar h2 { margin: 0 0 16px; font-size: 18px; }
    .nav a { display: block; padding: 10px 12px; margin-bottom: 6px; border-radius: 8px; color: #cbd5f5; text-decoration: none; }
    .nav a.active { background: #1e293b; color: #fff; }
    .content { padding: 24px; }
    .card { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 2px 10px rgba(15,23,42,0.06); }
    table { border-collapse: collapse; width: 100%; margin-top: 12px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f1f5f9; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
    .UNASSIGNED { background: #eee; }
    .CLAIMED { background: #ffe0b2; }
    .PAID { background: #c8e6c9; }
    .REFUNDED { background: #ffcdd2; }
    .PENDING_PAYMENT { background: #bbdefb; }
    a { color: #0d47a1; text-decoration: none; }
    .meta { color: #64748b; font-size: 12px; }
    .pager { margin-top: 12px; display: flex; gap: 8px; align-items: center; }
    .pager a { padding: 4px 8px; border-radius: 6px; background: #e2e8f0; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <h2>NavPay 管理台</h2>
      <div class="nav">
        <a href="/" class="${active === "users" ? "active" : ""}">用户列表</a>
        <a href="/orders" class="${active === "orders" ? "active" : ""}">订单列表</a>
      </div>
    </aside>
    <main class="content">
      <h1>${title}</h1>
      <div class="card">
        ${content}
      </div>
    </main>
  </div>
</body>
</html>`;
}

app.get("/", (req, res) => {
  const page = parseInt(req.query.page || "1", 10);
  const size = parseInt(req.query.size || "10", 10);
  const list = Array.from(users.values());
  const { items, current, totalPages, total } = paginate(list, page, size);
  const pagedRows = items.map((u) =>
    `<tr><td><a href="/users/${u.username}">${u.username}</a></td><td>${u.name}</td><td>${u.phone}</td><td>${u.email}</td><td>${u.claimFailures.length}</td></tr>`
  ).join("");
  const content = `
    <table>
      <thead><tr><th>Username</th><th>Name</th><th>Phone</th><th>Email</th><th>Claim Failures</th></tr></thead>
      <tbody>${pagedRows || "<tr><td colspan=\"5\">暂无数据</td></tr>"}</tbody>
    </table>
    <div class="pager">
      <span class="meta">共 ${total} 条</span>
      ${current > 1 ? `<a href="/?page=${current - 1}&size=${size}">上一页</a>` : ""}
      <span class="meta">第 ${current} / ${totalPages} 页</span>
      ${current < totalPages ? `<a href="/?page=${current + 1}&size=${size}">下一页</a>` : ""}
    </div>`;
  res.send(renderLayout("用户列表", "users", content));
});

app.get("/users/:username", (req, res) => {
  const user = users.get(req.params.username);
  if (!user) return res.status(404).send("User not found");
  const userOrders = orders.filter((o) => o.assignedTo === user.username);
  const ordersRows = userOrders.map((o) =>
    `<tr><td>${o.id}</td><td>${o.amount}</td><td>${o.currency}</td><td><span class="pill ${o.status}">${o.status}</span></td><td>${o.paymentApp}</td><td>${formatInIST(o.createdAt)}</td></tr>`
  ).join("");
  const failuresRows = user.claimFailures.map((f) =>
    `<tr><td>${f.orderId}</td><td>${formatInIST(f.claimedAt) || "-"}</td><td>${formatInIST(f.releasedAt)}</td></tr>`
  ).join("");
  const content = `
    <p class="meta"><a href="/">返回用户列表</a></p>
    <h2>用户信息</h2>
    <p>${user.name}（${user.username}）</p>
    <p>${user.phone} | ${user.email}</p>
    <h2>订单明细</h2>
    <table>
      <thead><tr><th>ID</th><th>Amount</th><th>Currency</th><th>Status</th><th>App</th><th>Created</th></tr></thead>
      <tbody>${ordersRows || "<tr><td colspan=\"6\">暂无订单</td></tr>"}</tbody>
    </table>
    <h2>抢单未完成记录</h2>
    <table>
      <thead><tr><th>Order</th><th>Claimed At</th><th>Released At</th></tr></thead>
      <tbody>${failuresRows || "<tr><td colspan=\"3\">暂无记录</td></tr>"}</tbody>
    </table>`;
  res.send(renderLayout(`用户详情 - ${user.username}`, "users", content));
});

app.get("/orders", (req, res) => {
  const page = parseInt(req.query.page || "1", 10);
  const size = parseInt(req.query.size || "10", 10);
  const { items, current, totalPages, total } = paginate(orders, page, size);
  const rows = items.map((o) =>
    `<tr><td>${o.id}</td><td>${o.amount}</td><td>${o.currency}</td><td><span class="pill ${o.status}">${o.status}</span></td><td>${o.paymentApp}</td><td>${o.assignedTo || "-"}</td><td>${formatInIST(o.createdAt)}</td></tr>`
  ).join("");
  const content = `
    <table>
      <thead><tr><th>ID</th><th>Amount</th><th>Currency</th><th>Status</th><th>App</th><th>User</th><th>Created</th></tr></thead>
      <tbody>${rows || "<tr><td colspan=\"7\">暂无数据</td></tr>"}</tbody>
    </table>
    <div class="pager">
      <span class="meta">共 ${total} 条</span>
      ${current > 1 ? `<a href="/orders?page=${current - 1}&size=${size}">上一页</a>` : ""}
      <span class="meta">第 ${current} / ${totalPages} 页</span>
      ${current < totalPages ? `<a href="/orders?page=${current + 1}&size=${size}">下一页</a>` : ""}
    </div>`;
  res.send(renderLayout("订单列表", "orders", content));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`NavPay server running on http://127.0.0.1:${port}`);
});
