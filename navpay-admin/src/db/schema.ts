import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// Keep schema SQLite-friendly, but Postgres-migration-friendly:
// - Use text UUID primary keys
// - Store money as decimal strings (future: PG numeric)
// - Store timestamps as integer epoch millis

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    email: text("email"),
    displayName: text("display_name").notNull(),
    // If set, this user is a merchant-portal user and can only access their own merchant data.
    merchantId: text("merchant_id"),

    passwordHash: text("password_hash").notNull(),
    passwordUpdatedAtMs: integer("password_updated_at_ms").notNull(),

    // Account security
    totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
    totpSecretEnc: text("totp_secret_enc"),
    totpBackupCodesHashJson: text("totp_backup_codes_hash_json"),
    totpMustEnroll: integer("totp_must_enroll", { mode: "boolean" }).notNull().default(true),

    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockUntilMs: integer("lock_until_ms"),

    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    usernameUx: uniqueIndex("users_username_ux").on(t.username),
    emailUx: uniqueIndex("users_email_ux").on(t.email),
    merchantIdx: index("users_merchant_idx").on(t.merchantId),
  }),
);

export const roles = sqliteTable(
  "roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    nameUx: uniqueIndex("roles_name_ux").on(t.name),
  }),
);

export const permissions = sqliteTable(
  "permissions",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    description: text("description"),
  },
  (t) => ({
    keyUx: uniqueIndex("permissions_key_ux").on(t.key),
  }),
);

export const userRoles = sqliteTable(
  "user_roles",
  {
    userId: text("user_id").notNull(),
    roleId: text("role_id").notNull(),
  },
  (t) => ({
    pk: uniqueIndex("user_roles_pk").on(t.userId, t.roleId),
    userIdx: index("user_roles_user_idx").on(t.userId),
    roleIdx: index("user_roles_role_idx").on(t.roleId),
  }),
);

export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id").notNull(),
    permissionId: text("permission_id").notNull(),
  },
  (t) => ({
    pk: uniqueIndex("role_permissions_pk").on(t.roleId, t.permissionId),
    roleIdx: index("role_permissions_role_idx").on(t.roleId),
  }),
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id"),
    // Optional merchant scope. Used by merchant portal & merchant API key calls.
    merchantId: text("merchant_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metaJson: text("meta_json"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    createdIdx: index("audit_logs_created_idx").on(t.createdAtMs),
    actorIdx: index("audit_logs_actor_idx").on(t.actorUserId),
    merchantIdx: index("audit_logs_merchant_idx").on(t.merchantId),
  }),
);

export const webauthnCredentials = sqliteTable(
  "webauthn_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    // Base64url strings for portability across DBs.
    credentialId: text("credential_id").notNull(),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transportsJson: text("transports_json"),
    deviceName: text("device_name"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAtMs: integer("last_used_at_ms"),
    revokedAtMs: integer("revoked_at_ms"),
  },
  (t) => ({
    userIdx: index("webauthn_credentials_user_idx").on(t.userId),
    credUx: uniqueIndex("webauthn_credentials_credential_ux").on(t.credentialId),
    revokedIdx: index("webauthn_credentials_revoked_idx").on(t.revokedAtMs),
  }),
);

export const merchants = sqliteTable(
  "merchants",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),

    // Money fields stored as decimal strings for portability.
    balance: text("balance").notNull().default("0"),
    payoutFrozen: text("payout_frozen").notNull().default("0"),

    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    codeUx: uniqueIndex("merchants_code_ux").on(t.code),
    enabledIdx: index("merchants_enabled_idx").on(t.enabled),
  }),
);

export const merchantApiKeys = sqliteTable(
  "merchant_api_keys",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),

    keyId: text("key_id").notNull(),
    secretEnc: text("secret_enc").notNull(),
    secretHash: text("secret_hash").notNull(),
    secretPrefix: text("secret_prefix").notNull(),

    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    revokedAtMs: integer("revoked_at_ms"),
  },
  (t) => ({
    merchantIdx: index("merchant_api_keys_merchant_idx").on(t.merchantId),
    keyIdUx: uniqueIndex("merchant_api_keys_key_id_ux").on(t.keyId),
  }),
);

export const merchantFees = sqliteTable(
  "merchant_fees",
  {
    merchantId: text("merchant_id").primaryKey(),
    collectFeeRateBps: integer("collect_fee_rate_bps").notNull().default(300), // 3.00%
    payoutFeeRateBps: integer("payout_fee_rate_bps").notNull().default(450), // 4.50%
    minFee: text("min_fee").notNull().default("0"),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
);

export const merchantLimitRules = sqliteTable(
  "merchant_limit_rules",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    type: text("type").notNull(), // collect | payout
    minAmount: text("min_amount").notNull().default("0"),
    maxAmount: text("max_amount").notNull().default("0"),
    dailyCountLimit: integer("daily_count_limit").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    note: text("note"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    merchantIdx: index("merchant_limit_rules_merchant_idx").on(t.merchantId),
    typeIdx: index("merchant_limit_rules_type_idx").on(t.type),
  }),
);

export const merchantIpWhitelist = sqliteTable(
  "merchant_ip_whitelist",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    ip: text("ip").notNull(),
    note: text("note"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    merchantIdx: index("merchant_ip_whitelist_merchant_idx").on(t.merchantId),
    enabledIdx: index("merchant_ip_whitelist_enabled_idx").on(t.enabled),
    merchantIpUx: uniqueIndex("merchant_ip_whitelist_ux").on(t.merchantId, t.ip),
  }),
);

export const paymentApps = sqliteTable(
  "payment_apps",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    packageName: text("package_name").notNull(),
    versionCode: integer("version_code").notNull().default(1),
    downloadUrl: text("download_url").notNull(),
    promoted: integer("promoted", { mode: "boolean" }).notNull().default(false),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    pkgUx: uniqueIndex("payment_apps_pkg_ux").on(t.packageName),
    enabledIdx: index("payment_apps_enabled_idx").on(t.enabled),
  }),
);

export const h5Sites = sqliteTable(
  "h5_sites",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    merchantIdx: index("h5_sites_merchant_idx").on(t.merchantId),
  }),
);

export const paymentPersons = sqliteTable(
  "payment_persons",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    name: text("name").notNull(),
    balance: text("balance").notNull().default("0.00"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    nameUx: uniqueIndex("payment_persons_name_ux").on(t.name),
    userUx: uniqueIndex("payment_persons_user_ux").on(t.userId),
    enabledIdx: index("payment_persons_enabled_idx").on(t.enabled),
  }),
);

export const paymentPersonBalanceLogs = sqliteTable(
  "payment_person_balance_logs",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull(),
    delta: text("delta").notNull(),
    balanceAfter: text("balance_after").notNull(),
    reason: text("reason").notNull(),
    refType: text("ref_type"),
    refId: text("ref_id"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    personIdx: index("payment_person_balance_logs_person_idx").on(t.personId),
    refUx: uniqueIndex("payment_person_balance_logs_ref_ux").on(t.personId, t.refType, t.refId),
  }),
);

export const paymentDevices = sqliteTable(
  "payment_devices",
  {
    id: text("id").primaryKey(),
    personId: text("person_id"),
    name: text("name").notNull(),
    online: integer("online", { mode: "boolean" }).notNull().default(false),
    lastSeenAtMs: integer("last_seen_at_ms"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    personIdx: index("payment_devices_person_idx").on(t.personId),
    onlineIdx: index("payment_devices_online_idx").on(t.online),
  }),
);

export const paymentDeviceApps = sqliteTable(
  "payment_device_apps",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id").notNull(),
    paymentAppId: text("payment_app_id").notNull(),
    versionCode: integer("version_code").notNull().default(1),
    installedAtMs: integer("installed_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    ux: uniqueIndex("payment_device_apps_ux").on(t.deviceId, t.paymentAppId),
    deviceIdx: index("payment_device_apps_device_idx").on(t.deviceId),
  }),
);

export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull(),
    bankName: text("bank_name").notNull(),
    alias: text("alias").notNull(),
    accountLast4: text("account_last4").notNull(),
    ifsc: text("ifsc"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    personIdx: index("bank_accounts_person_idx").on(t.personId),
    enabledIdx: index("bank_accounts_enabled_idx").on(t.enabled),
  }),
);

export const bankTransactions = sqliteTable(
  "bank_transactions",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    direction: text("direction").notNull(), // IN | OUT
    amount: text("amount").notNull(),
    ref: text("ref"),
    detailsJson: text("details_json"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    accountIdx: index("bank_transactions_account_idx").on(t.accountId),
    createdIdx: index("bank_transactions_created_idx").on(t.createdAtMs),
  }),
);

export const personalApiTokens = sqliteTable(
  "personal_api_tokens",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    lastUsedAtMs: integer("last_used_at_ms"),
    revokedAtMs: integer("revoked_at_ms"),
  },
  (t) => ({
    hashUx: uniqueIndex("personal_api_tokens_hash_ux").on(t.tokenHash),
    personIdx: index("personal_api_tokens_person_idx").on(t.personId),
    revokedIdx: index("personal_api_tokens_revoked_idx").on(t.revokedAtMs),
  }),
);

export const paymentPersonLoginLogs = sqliteTable(
  "payment_person_login_logs",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull(),
    event: text("event").notNull(), // LOGIN | LOGOUT
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    personIdx: index("payment_person_login_logs_person_idx").on(t.personId),
    createdIdx: index("payment_person_login_logs_created_idx").on(t.createdAtMs),
  }),
);

export const paymentPersonReportLogs = sqliteTable(
  "payment_person_report_logs",
  {
    id: text("id").primaryKey(),
    personId: text("person_id").notNull(),
    type: text("type").notNull(), // LOGIN | LOGOUT | DEVICE_REPORT | APP_REPORT | BANK_ACCOUNT_REPORT | TX_REPORT
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metaJson: text("meta_json"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    personIdx: index("payment_person_report_logs_person_idx").on(t.personId),
    createdIdx: index("payment_person_report_logs_created_idx").on(t.createdAtMs),
  }),
);

export const collectOrders = sqliteTable(
  "collect_orders",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    merchantOrderNo: text("merchant_order_no").notNull(),
    amount: text("amount").notNull(),
    fee: text("fee").notNull().default("0"),
    status: text("status").notNull(), // CREATED | PENDING_PAY | PAID | SUCCESS | FAILED | EXPIRED
    notifyUrl: text("notify_url").notNull(),
    remark: text("remark"),

    channelType: text("channel_type").notNull().default("h5"), // h5 | payment_app | usdt
    paymentAppId: text("payment_app_id"),
    h5SiteId: text("h5_site_id"),

    notifyStatus: text("notify_status").notNull().default("PENDING"), // PENDING | SUCCESS | FAILED
    lastNotifiedAtMs: integer("last_notified_at_ms"),

    assignedPaymentPersonId: text("assigned_payment_person_id"),
    assignedAtMs: integer("assigned_at_ms"),

    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    merchantIdx: index("collect_orders_merchant_idx").on(t.merchantId),
    statusIdx: index("collect_orders_status_idx").on(t.status),
    assignedPersonIdx: index("collect_orders_assigned_person_idx").on(t.assignedPaymentPersonId),
    merchantOrderUx: uniqueIndex("collect_orders_merchant_order_ux").on(
      t.merchantId,
      t.merchantOrderNo,
    ),
  }),
);

export const payoutOrders = sqliteTable(
  "payout_orders",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    merchantOrderNo: text("merchant_order_no").notNull(),
    amount: text("amount").notNull(),
    fee: text("fee").notNull().default("0"),
    status: text("status").notNull(), // CREATED | REVIEW_PENDING | APPROVED | BANK_CONFIRMING | SUCCESS | FAILED | REJECTED | EXPIRED
    notifyUrl: text("notify_url").notNull(),
    remark: text("remark"),

    beneficiaryName: text("beneficiary_name").notNull(),
    bankName: text("bank_name"),
    accountNo: text("account_no").notNull(),
    ifsc: text("ifsc").notNull(),

    notifyStatus: text("notify_status").notNull().default("PENDING"), // PENDING | SUCCESS | FAILED
    lastNotifiedAtMs: integer("last_notified_at_ms"),

    lockedPaymentPersonId: text("locked_payment_person_id"),
    lockMode: text("lock_mode").notNull().default("AUTO"), // AUTO | MANUAL
    lockedAtMs: integer("locked_at_ms"),
    lockExpiresAtMs: integer("lock_expires_at_ms"),

    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    merchantIdx: index("payout_orders_merchant_idx").on(t.merchantId),
    statusIdx: index("payout_orders_status_idx").on(t.status),
    lockedPersonIdx: index("payout_orders_locked_person_idx").on(t.lockedPaymentPersonId),
    lockExpiresIdx: index("payout_orders_lock_expires_idx").on(t.lockExpiresAtMs),
    merchantOrderUx: uniqueIndex("payout_orders_merchant_order_ux").on(
      t.merchantId,
      t.merchantOrderNo,
    ),
  }),
);

export const callbackTasks = sqliteTable(
  "callback_tasks",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id").notNull(),
    orderType: text("order_type").notNull(), // collect | payout | usdt
    orderId: text("order_id").notNull(),
    url: text("url").notNull(),
    payloadJson: text("payload_json").notNull(),
    signature: text("signature").notNull(),

    status: text("status").notNull().default("PENDING"), // PENDING | SENDING | SUCCESS | FAILED
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAtMs: integer("next_attempt_at_ms").notNull(),
    lastError: text("last_error"),

    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    statusIdx: index("callback_tasks_status_idx").on(t.status),
    nextIdx: index("callback_tasks_next_idx").on(t.nextAttemptAtMs),
  }),
);

export const callbackAttempts = sqliteTable(
  "callback_attempts",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull(),
    requestBody: text("request_body").notNull(),
    responseCode: integer("response_code"),
    responseBody: text("response_body"),
    durationMs: integer("duration_ms"),
    error: text("error"),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    taskIdx: index("callback_attempts_task_idx").on(t.taskId),
  }),
);

export const systemConfigs = sqliteTable(
  "system_configs",
  {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
    description: text("description"),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
);

export const ipWhitelist = sqliteTable(
  "ip_whitelist",
  {
    id: text("id").primaryKey(),
    ip: text("ip").notNull(),
    note: text("note"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    ipUx: uniqueIndex("ip_whitelist_ip_ux").on(t.ip),
    enabledIdx: index("ip_whitelist_enabled_idx").on(t.enabled),
  }),
);

export const usdtDeposits = sqliteTable(
  "usdt_deposits",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id"),
    chain: text("chain").notNull().default("BSC"),
    txHash: text("tx_hash").notNull(),
    amount: text("amount").notNull(),
    status: text("status").notNull().default("PENDING"), // PENDING | SUCCESS | FAILED
    confirmations: integer("confirmations").notNull().default(0),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAtMs: integer("updated_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    txUx: uniqueIndex("usdt_deposits_tx_ux").on(t.txHash),
    statusIdx: index("usdt_deposits_status_idx").on(t.status),
  }),
);

export const webhookReceivers = sqliteTable(
  "webhook_receivers",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    createdIdx: index("webhook_receivers_created_idx").on(t.createdAtMs),
  }),
);

export const webhookEvents = sqliteTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    receiverId: text("receiver_id").notNull(),
    headersJson: text("headers_json").notNull(),
    body: text("body").notNull(),
    createdAtMs: integer("created_at_ms")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    receiverIdx: index("webhook_events_receiver_idx").on(t.receiverId),
    createdIdx: index("webhook_events_created_idx").on(t.createdAtMs),
  }),
);
