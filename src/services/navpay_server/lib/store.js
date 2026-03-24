import crypto from "crypto";
import fs from "fs";
import path from "path";

const TOKEN_TTL_MS = 1000 * 60 * 30;
const CLAIM_TTL_MS = 1000 * 60 * 5;

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
  { id: "ORD-A1013", amount: 199.94, currency: "INR", status: "PENDING_PAYMENT", createdAt: "2026-02-02T20:00:00Z", paymentApp: "PE", assignedTo: "alice", claimedAt: null, claimExpiresAt: null },
  { id: "ORD-O3001", amount: 649.94, currency: "INR", status: "UNASSIGNED", createdAt: "2026-02-01T10:00:00Z", paymentApp: "PE", assignedTo: null, claimedAt: null, claimExpiresAt: null },
  { id: "ORD-O3002", amount: 459.51, currency: "INR", status: "UNASSIGNED", createdAt: "2026-02-01T12:00:00Z", paymentApp: "PE", assignedTo: null, claimedAt: null, claimExpiresAt: null },
  { id: "ORD-O3003", amount: 749.19, currency: "INR", status: "UNASSIGNED", createdAt: "2026-02-01T14:00:00Z", paymentApp: "PE", assignedTo: null, claimedAt: null, claimExpiresAt: null },
  { id: "ORD-O3004", amount: 349.59, currency: "INR", status: "UNASSIGNED", createdAt: "2026-02-01T16:00:00Z", paymentApp: "PE", assignedTo: null, claimedAt: null, claimExpiresAt: null },
  { id: "ORD-O3005", amount: 459.85, currency: "INR", status: "UNASSIGNED", createdAt: "2026-02-01T18:00:00Z", paymentApp: "PE", assignedTo: null, claimedAt: null, claimExpiresAt: null }
];

const dataDir = path.resolve(process.cwd(), ".data");
const tokenFile = path.join(dataDir, "tokens.json");
const tokens = new Map();

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function loadTokens() {
  try {
    if (!fs.existsSync(tokenFile)) return;
    const raw = fs.readFileSync(tokenFile, "utf8");
    const parsed = JSON.parse(raw);
    for (const [token, entry] of Object.entries(parsed || {})) {
      if (entry && entry.username && entry.expiresAt) {
        tokens.set(token, entry);
      }
    }
  } catch {
    // ignore corrupted token file
  }
}

function persistTokens() {
  try {
    ensureDataDir();
    const obj = Object.fromEntries(tokens.entries());
    fs.writeFileSync(tokenFile, JSON.stringify(obj, null, 2));
  } catch {
    // ignore write failures
  }
}

loadTokens();

export function issueToken(username) {
  const token = crypto.randomBytes(24).toString("base64url");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  tokens.set(token, { username, expiresAt });
  persistTokens();
  return { token, expiresAt };
}

export function verifyToken(authHeader) {
  const auth = authHeader || "";
  const parts = auth.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return { ok: false, error: "missing_token" };
  }
  const token = parts[1];
  const entry = tokens.get(token);
  if (!entry) {
    return { ok: false, error: "invalid_token" };
  }
  if (Date.now() > entry.expiresAt) {
    tokens.delete(token);
    return { ok: false, error: "token_expired" };
  }
  return { ok: true, username: entry.username, token };
}

export function revokeToken(token) {
  tokens.delete(token);
  persistTokens();
}

export function refreshExpiredClaims() {
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

function purgeExpiredTokens() {
  const now = Date.now();
  let changed = false;
  for (const [token, entry] of tokens.entries()) {
    if (now > entry.expiresAt) {
      tokens.delete(token);
      changed = true;
    }
  }
  if (changed) persistTokens();
}

purgeExpiredTokens();

export function formatOrder(order) {
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

export function paginate(items, page, pageSize) {
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

export function formatInIST(isoOrMillis) {
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

export function getUsers() {
  return Array.from(users.values());
}

export function getUser(username) {
  return users.get(username);
}

export function updateUser(username, update) {
  const user = users.get(username);
  if (!user) return null;
  if (typeof update.name === "string") user.name = update.name;
  if (typeof update.phone === "string") user.phone = update.phone;
  if (typeof update.email === "string") user.email = update.email;
  return user;
}

export function getOrders() {
  return orders;
}

export function getOrdersForUser(username) {
  return orders.filter((o) => o.assignedTo === username);
}

export function getOpenOrders() {
  return orders.filter((o) => o.status === "UNASSIGNED");
}

export function claimOrder(orderId, username) {
  const order = orders.find((o) => o.id === orderId);
  if (!order) {
    return { ok: false, error: "order_not_found" };
  }
  if (order.status !== "UNASSIGNED") {
    return { ok: false, error: "order_not_available" };
  }
  const now = Date.now();
  order.status = "CLAIMED";
  order.assignedTo = username;
  order.claimedAt = new Date(now).toISOString();
  order.claimExpiresAt = now + CLAIM_TTL_MS;
  return { ok: true, order: formatOrder(order) };
}

export function getEarnings(username) {
  const user = users.get(username);
  if (!user) return null;
  const total = user.earnings.reduce((sum, e) => sum + e.amount, 0);
  return { total, earnings: user.earnings };
}
