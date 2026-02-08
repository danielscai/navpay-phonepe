import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auditLogs } from "@/db/schema";
import { id } from "@/lib/id";
import { getClientIp } from "@/lib/http";

export async function writeAuditLog(opts: {
  req: NextRequest;
  actorUserId: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: any;
}) {
  try {
    const ip = getClientIp(opts.req);
    const ua = opts.req.headers.get("user-agent");
    await db.insert(auditLogs).values({
      id: id("al"),
      actorUserId: opts.actorUserId,
      action: opts.action,
      entityType: opts.entityType ?? null,
      entityId: opts.entityId ?? null,
      metaJson: opts.meta ? JSON.stringify(opts.meta).slice(0, 4000) : null,
      ip: ip ?? null,
      userAgent: ua ? ua.slice(0, 256) : null,
      createdAtMs: Date.now(),
    });
  } catch {
    // Never block business flow due to audit write failure.
  }
}

