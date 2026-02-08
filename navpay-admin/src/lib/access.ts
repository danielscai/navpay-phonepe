import { headers } from "next/headers";
import { db } from "@/lib/db";
import { ipWhitelist } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function requireIpAllowed() {
  const h = await headers();
  const xf = h.get("x-forwarded-for");
  const ip = (xf ? xf.split(",")[0]?.trim() : h.get("x-real-ip")) ?? null;
  if (!ip) return;

  const rows = await db.select().from(ipWhitelist).where(eq(ipWhitelist.ip, ip)).limit(1);
  const row = rows[0];
  if (!row || !row.enabled) {
    throw new Error("ip_not_allowed:" + ip);
  }
}

