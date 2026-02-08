import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { callbackAttempts, callbackTasks } from "@/db/schema";
import { and, eq, lte } from "drizzle-orm";
import { requireApiPerm } from "@/lib/api";
import { id } from "@/lib/id";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";

function backoffMs(attempt: number, baseSeconds: number): number {
  const a = Math.max(1, attempt);
  return baseSeconds * 1000 * Math.pow(2, a - 1);
}

export async function POST(req: NextRequest) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { uid } = await requireApiPerm(req, "callback.retry");

  const now = Date.now();
  const due = await db
    .select()
    .from(callbackTasks)
    .where(and(eq(callbackTasks.status, "PENDING"), lte(callbackTasks.nextAttemptAtMs, now)))
    .limit(20);

  let processed = 0;
  for (const t of due) {
    processed++;
    const start = Date.now();
    let responseCode: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;

    try {
      const r = await fetch(t.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-navpay-signature": t.signature,
        },
        body: t.payloadJson,
      });
      responseCode = r.status;
      responseBody = (await r.text()).slice(0, 2000);
      if (r.ok) {
        await db
          .update(callbackTasks)
          .set({ status: "SUCCESS", updatedAtMs: Date.now() })
          .where(eq(callbackTasks.id, t.id));
      } else {
        throw new Error(`http_${r.status}`);
      }
    } catch (e: any) {
      error = String(e?.message ?? e);
      const nextAttempt = t.attemptCount + 1;
      const max = t.maxAttempts;
      if (nextAttempt >= max) {
        await db
          .update(callbackTasks)
          .set({
            status: "FAILED",
            attemptCount: nextAttempt,
            lastError: error,
            updatedAtMs: Date.now(),
          })
          .where(eq(callbackTasks.id, t.id));
      } else {
        const nextAt = Date.now() + backoffMs(nextAttempt, 60);
        await db
          .update(callbackTasks)
          .set({
            status: "PENDING",
            attemptCount: nextAttempt,
            nextAttemptAtMs: nextAt,
            lastError: error,
            updatedAtMs: Date.now(),
          })
          .where(eq(callbackTasks.id, t.id));
      }
    } finally {
      const durationMs = Date.now() - start;
      await db.insert(callbackAttempts).values({
        id: id("cba"),
        taskId: t.id,
        requestBody: t.payloadJson,
        responseCode: responseCode ?? undefined,
        responseBody: responseBody ?? undefined,
        durationMs,
        error: error ?? undefined,
        createdAtMs: Date.now(),
      });
    }
  }

  await writeAuditLog({
    req,
    actorUserId: uid,
    action: "callback.worker_run",
    entityType: "callback_task",
    entityId: null,
    meta: { processed },
  });

  return NextResponse.json({ ok: true, processed });
}
