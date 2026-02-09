import { db } from "@/lib/db";
import { systemConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getSystemConfig(key: string): Promise<{ key: string; value: string; description?: string | null } | null> {
  const rows = await db.select().from(systemConfigs).where(eq(systemConfigs.key, key)).limit(1);
  return (rows[0] as any) ?? null;
}

export async function ensureSystemConfig(opts: { key: string; value: string; description: string }): Promise<void> {
  const existing = await getSystemConfig(opts.key);
  if (existing) return;
  await db.insert(systemConfigs).values({ key: opts.key, value: opts.value, description: opts.description, updatedAtMs: Date.now() } as any);
}

export async function getSystemConfigNumber(opts: { key: string; defaultValue: number; description: string; min?: number; max?: number }): Promise<number> {
  await ensureSystemConfig({ key: opts.key, value: String(opts.defaultValue), description: opts.description });
  const row = await getSystemConfig(opts.key);
  const raw = row?.value ?? String(opts.defaultValue);
  const n = Number(raw);
  if (!Number.isFinite(n)) return opts.defaultValue;
  if (opts.min !== undefined && n < opts.min) return opts.min;
  if (opts.max !== undefined && n > opts.max) return opts.max;
  return n;
}

export async function getSystemConfigBool(opts: { key: string; defaultValue: boolean; description: string }): Promise<boolean> {
  await ensureSystemConfig({ key: opts.key, value: opts.defaultValue ? "true" : "false", description: opts.description });
  const row = await getSystemConfig(opts.key);
  const raw = (row?.value ?? (opts.defaultValue ? "true" : "false")).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return opts.defaultValue;
}
