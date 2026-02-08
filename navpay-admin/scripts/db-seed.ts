import "dotenv/config";
import { db } from "@/lib/db";
import { id } from "@/lib/id";
import { encryptString, randomToken, sha256Hex } from "@/lib/crypto";
import { env } from "@/lib/env";
import { hashPassword, validateStrongPassword } from "@/lib/password";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
  systemConfigs,
  merchants,
  merchantFees,
  merchantApiKeys,
} from "@/db/schema";
import { eq } from "drizzle-orm";

const PERMS = [
  { key: "admin.all", description: "All access" },

  { key: "merchant.read", description: "View merchants" },
  { key: "merchant.write", description: "Manage merchants" },
  { key: "merchant.secrets.rotate", description: "Rotate merchant API keys" },

  { key: "order.collect.read", description: "View collect orders" },
  { key: "order.collect.write", description: "Manage collect orders" },

  { key: "order.payout.read", description: "View payout orders" },
  { key: "order.payout.write", description: "Create/manage payout orders" },
  { key: "order.payout.review", description: "Review payout orders" },
  { key: "order.payout.finalize", description: "Finalize payout orders (high risk)" },

  { key: "callback.read", description: "View callback queue" },
  { key: "callback.retry", description: "Retry callbacks" },

  { key: "system.read", description: "View system config" },
  { key: "system.write", description: "Manage system config" },

  { key: "audit.read", description: "View audit logs" },
  { key: "tools.debug", description: "Access debug tools" },
];

const ROLE_DEF: Record<string, string[]> = {
  "超级管理员": ["admin.all"],
  "运营": [
    "merchant.read",
    "order.collect.read",
    "order.collect.write",
    "order.payout.read",
    "order.payout.write",
    "callback.read",
    "system.read",
    "audit.read",
  ],
  "财务": ["merchant.read", "order.collect.read", "order.payout.read", "callback.read"],
  "审核员": ["merchant.read", "order.payout.read", "order.payout.review", "callback.read"],
  "只读": ["merchant.read", "order.collect.read", "order.payout.read", "callback.read", "system.read"],
};

async function upsertPermissions() {
  for (const p of PERMS) {
    const exists = await db.select().from(permissions).where(eq(permissions.key, p.key));
    if (exists.length) continue;
    await db.insert(permissions).values({ id: id("perm"), key: p.key, description: p.description });
  }
}

async function upsertRoles() {
  for (const [roleName] of Object.entries(ROLE_DEF)) {
    const exists = await db.select().from(roles).where(eq(roles.name, roleName));
    if (exists.length) continue;
    await db.insert(roles).values({ id: id("role"), name: roleName, description: roleName });
  }
}

async function linkRolePerms() {
  const roleRows = await db.select().from(roles);
  const permRows = await db.select().from(permissions);
  const permByKey = new Map(permRows.map((p) => [p.key, p]));

  for (const r of roleRows) {
    const keys = ROLE_DEF[r.name] ?? [];
    if (keys.includes("admin.all")) {
      // Map to all permissions.
      for (const p of permRows) {
        await db
          .insert(rolePermissions)
          .values({ roleId: r.id, permissionId: p.id })
          .onConflictDoNothing();
      }
      continue;
    }

    for (const k of keys) {
      const p = permByKey.get(k);
      if (!p) continue;
      await db
        .insert(rolePermissions)
        .values({ roleId: r.id, permissionId: p.id })
        .onConflictDoNothing();
    }
  }
}

async function upsertSystemDefaults() {
  const defaults = [
    { key: "order.collect.expire_minutes", value: "20", description: "代收订单超时分钟数" },
    { key: "callback.max_attempts", value: "5", description: "回调最大重试次数" },
    { key: "callback.base_delay_seconds", value: "60", description: "回调重试基础延迟(秒)" },
    { key: "timezone.default", value: env.DEFAULT_TIMEZONE, description: "默认展示时区" },
    { key: "timezone.alt", value: "Asia/Kolkata", description: "可切换时区" },
  ];
  for (const d of defaults) {
    await db
      .insert(systemConfigs)
      .values({ key: d.key, value: d.value, description: d.description })
      .onConflictDoUpdate({
        target: systemConfigs.key,
        set: { value: d.value, description: d.description, updatedAtMs: Date.now() },
      });
  }
}

async function createAdminUser() {
  const username = "admin";
  const email = "admin@navpay.local";
  const displayName = "管理员";
  const password = "NavPay@123456!";
  const ok = validateStrongPassword(password);
  if (!ok.ok) throw new Error("Seed password not strong enough: " + ok.reason);

  const existing = await db.select().from(users).where(eq(users.username, username));
  if (existing.length) return;

  const passwordHash = await hashPassword(password);
  const userId = id("user");
  await db.insert(users).values({
    id: userId,
    username,
    email,
    displayName,
    passwordHash,
    passwordUpdatedAtMs: Date.now(),
    totpEnabled: false,
    totpMustEnroll: true,
  });

  const roleRows = await db.select().from(roles).where(eq(roles.name, "超级管理员"));
  const role = roleRows[0];
  if (role) {
    await db.insert(userRoles).values({ userId, roleId: role.id }).onConflictDoNothing();
  }

  console.log("seed admin:", { username, password });
}

async function createQaUser() {
  const username = "qa";
  const email = "qa@navpay.local";
  const displayName = "QA 测试账号";
  const password = "NavPayQA@123456!";
  const ok = validateStrongPassword(password);
  if (!ok.ok) throw new Error("Seed password not strong enough: " + ok.reason);

  // Deterministic QA 2FA for repeatable E2E. Do not use for real users.
  // Base32 secret that decodes to 20 bytes (meets otplib MIN_SECRET_BYTES=16).
  const qaTotpSecretBase32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  const qaTotpSecretEnc = encryptString(qaTotpSecretBase32, env.TOTP_ENCRYPTION_KEY);
  const qaBackupCodes = [
    "NPQA2FA1",
    "NPQA2FA2",
    "NPQA2FA3",
    "NPQA2FA4",
    "NPQA2FA5",
    "NPQA2FA6",
    "NPQA2FA7",
    "NPQA2FA8",
    "NPQA2FA9",
    "NPQA2FAA",
  ];
  const qaBackupCodesHashJson = JSON.stringify(qaBackupCodes.map((c) => sha256Hex(c)));

  const passwordHash = await hashPassword(password);
  const existing = await db.select().from(users).where(eq(users.username, username));
  if (existing.length) {
    await db
      .update(users)
      .set({
        email,
        displayName,
        passwordHash,
        passwordUpdatedAtMs: Date.now(),
        totpEnabled: true,
        totpMustEnroll: false,
        totpSecretEnc: qaTotpSecretEnc,
        totpBackupCodesHashJson: qaBackupCodesHashJson,
        failedLoginCount: 0,
        lockUntilMs: null as any,
        updatedAtMs: Date.now(),
      })
      .where(eq(users.id, existing[0].id));
  } else {
    const userId = id("user");
    await db.insert(users).values({
      id: userId,
      username,
      email,
      displayName,
      passwordHash,
      passwordUpdatedAtMs: Date.now(),
      totpEnabled: true,
      totpMustEnroll: false,
      totpSecretEnc: qaTotpSecretEnc,
      totpBackupCodesHashJson: qaBackupCodesHashJson,
    });

    const roleRows = await db.select().from(roles).where(eq(roles.name, "超级管理员"));
    const role = roleRows[0];
    if (role) {
      await db.insert(userRoles).values({ userId, roleId: role.id }).onConflictDoNothing();
    }
  }

  console.log("seed qa:", { username, password });
}

async function createQaEnrollUser() {
  const username = "qa_enroll";
  const email = "qa_enroll@navpay.local";
  const displayName = "QA 首登绑定账号";
  const password = "NavPayEnroll@123456!";
  const ok = validateStrongPassword(password);
  if (!ok.ok) throw new Error("Seed password not strong enough: " + ok.reason);

  const existing = await db.select().from(users).where(eq(users.username, username));
  if (existing.length) return;

  const passwordHash = await hashPassword(password);
  const userId = id("user");
  await db.insert(users).values({
    id: userId,
    username,
    email,
    displayName,
    passwordHash,
    passwordUpdatedAtMs: Date.now(),
    totpEnabled: false,
    totpMustEnroll: true,
  });

  const roleRows = await db.select().from(roles).where(eq(roles.name, "超级管理员"));
  const role = roleRows[0];
  if (role) {
    await db.insert(userRoles).values({ userId, roleId: role.id }).onConflictDoNothing();
  }

  console.log("seed qa_enroll:", { username, password });
}

async function seedMerchantDemo() {
  const code = "M0001";
  const exists = await db.select().from(merchants).where(eq(merchants.code, code));
  if (exists.length) return;

  const merchantId = id("mch");
  await db.insert(merchants).values({
    id: merchantId,
    code,
    name: "Demo 商户",
    enabled: true,
    balance: "100000.00",
    payoutFrozen: "0.00",
  });

  await db.insert(merchantFees).values({
    merchantId,
    collectFeeRateBps: 300,
    payoutFeeRateBps: 450,
    minFee: "0.00",
    updatedAtMs: Date.now(),
  });

  const secret = "sk_" + randomToken(18);
  const secretEnc = encryptString(secret, env.APIKEY_ENCRYPTION_KEY);
  await db.insert(merchantApiKeys).values({
    id: id("key"),
    merchantId,
    keyId: "kid_" + randomToken(8),
    secretEnc,
    secretHash: sha256Hex(secret),
    secretPrefix: secret.slice(0, 6),
  });
}

async function main() {
  await upsertPermissions();
  await upsertRoles();
  await linkRolePerms();
  await upsertSystemDefaults();
  await createAdminUser();
  await createQaUser();
  await createQaEnrollUser();
  await seedMerchantDemo();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
