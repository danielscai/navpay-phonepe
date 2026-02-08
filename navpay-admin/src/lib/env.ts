import { z } from "zod";

function boolFromEnv(v: unknown, defaultValue = false): boolean {
  if (typeof v !== "string") return defaultValue;
  const s = v.trim().toLowerCase();
  if (!s) return defaultValue;
  return ["1", "true", "yes", "on"].includes(s);
}

const schema = z.object({
  DATABASE_URL: z.string().default("file:./data/dev.db"),
  AUTH_SECRET: z.string().min(16),
  TOTP_ENCRYPTION_KEY: z.string().min(16),
  APIKEY_ENCRYPTION_KEY: z.string().min(16),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DEFAULT_TIMEZONE: z.string().default("Asia/Shanghai"),
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_ORIGIN: z.string().optional(),
  ENABLE_DEBUG_TOOLS: z.boolean().default(false),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  AUTH_SECRET: process.env.AUTH_SECRET,
  TOTP_ENCRYPTION_KEY: process.env.TOTP_ENCRYPTION_KEY,
  APIKEY_ENCRYPTION_KEY: process.env.APIKEY_ENCRYPTION_KEY,
  APP_BASE_URL: process.env.APP_BASE_URL,
  DEFAULT_TIMEZONE: process.env.DEFAULT_TIMEZONE,
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
  WEBAUTHN_ORIGIN: process.env.WEBAUTHN_ORIGIN,
  // Dev default: enabled; Prod default: disabled (must explicitly opt-in).
  ENABLE_DEBUG_TOOLS: boolFromEnv(process.env.ENABLE_DEBUG_TOOLS, process.env.NODE_ENV !== "production"),
});
