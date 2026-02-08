import type { NextRequest } from "next/server";
import { requireApiUser } from "@/lib/api";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function requireApiMerchantUser(req: NextRequest, opts?: { csrf?: boolean }) {
  const { uid } = await requireApiUser(req, opts);
  const row = await db.select().from(users).where(eq(users.id, uid)).limit(1);
  const u = row[0];
  if (!u?.merchantId) {
    const e = new Error("forbidden");
    (e as any).status = 403;
    throw e;
  }
  return { uid, merchantId: u.merchantId, user: u };
}

