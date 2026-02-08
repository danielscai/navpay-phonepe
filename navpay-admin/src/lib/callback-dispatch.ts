import { db } from "@/lib/db";
import { callbackAttempts, callbackTasks, collectOrders, payoutOrders } from "@/db/schema";
import { and, eq, lte } from "drizzle-orm";
import { id } from "@/lib/id";
import { getSystemConfigNumber } from "@/lib/system-config";

function backoffMs(attempt: number, baseSeconds: number): number {
  const a = Math.max(1, attempt);
  return baseSeconds * 1000 * Math.pow(2, a - 1);
}

export const CALLBACK_MAX_ATTEMPTS_KEY = "callback.max_attempts";

export async function getCallbackMaxAttempts(): Promise<number> {
  return await getSystemConfigNumber({
    key: CALLBACK_MAX_ATTEMPTS_KEY,
    defaultValue: 3,
    min: 1,
    max: 20,
    description: "回调通知最大重试次数（含第一次发送）。默认 3。",
  });
}

async function markOrderNotify(orderType: string, orderId: string, notifyStatus: "PENDING" | "SUCCESS" | "FAILED", nowMs: number) {
  if (orderType === "collect") {
    await db
      .update(collectOrders)
      .set({ notifyStatus, lastNotifiedAtMs: notifyStatus === "SUCCESS" ? nowMs : undefined } as any)
      .where(eq(collectOrders.id, orderId));
    return;
  }
  if (orderType === "payout") {
    await db
      .update(payoutOrders)
      .set({ notifyStatus, lastNotifiedAtMs: notifyStatus === "SUCCESS" ? nowMs : undefined } as any)
      .where(eq(payoutOrders.id, orderId));
  }
}

async function sendOnce(t: any, nowMs: number): Promise<{ ok: boolean; responseCode?: number; responseBody?: string; error?: string; durationMs: number }> {
  const start = Date.now();
  let responseCode: number | null = null;
  let responseBody: string | null = null;
  let error: string | null = null;
  try {
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), 6000);
    const r = await fetch(t.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-navpay-signature": t.signature },
      body: t.payloadJson,
      signal: ac.signal,
    }).finally(() => clearTimeout(timeout));
    responseCode = r.status;
    responseBody = (await r.text()).slice(0, 2000);
    if (!r.ok) throw new Error(`http_${r.status}`);
    return { ok: true, responseCode: responseCode ?? undefined, responseBody: responseBody ?? undefined, durationMs: Date.now() - start };
  } catch (e: any) {
    error = String(e?.message ?? e);
    return { ok: false, responseCode: responseCode ?? undefined, responseBody: responseBody ?? undefined, error, durationMs: Date.now() - start };
  } finally {
    // attempts are recorded by the caller
  }
}

// Immediate dispatch for a single task: retry up to maxAttempts without requiring cron.
export async function dispatchCallbackTaskImmediate(taskId: string): Promise<{ ok: boolean; attempts: number }> {
  const maxAttemptsCfg = await getCallbackMaxAttempts();
  const row = await db.select().from(callbackTasks).where(eq(callbackTasks.id, taskId)).limit(1);
  const t: any = row[0];
  if (!t) return { ok: false, attempts: 0 };

  const nowMs = Date.now();
  const max = Math.max(1, Math.min(20, Number(t.maxAttempts ?? maxAttemptsCfg)));
  let attempts = Number(t.attemptCount ?? 0);

  // Only dispatch when pending.
  if (String(t.status) !== "PENDING") return { ok: String(t.status) === "SUCCESS", attempts };

  while (attempts < max) {
    const res = await sendOnce(t, nowMs);
    attempts++;

    await db.insert(callbackAttempts).values({
      id: id("cba"),
      taskId: t.id,
      requestBody: t.payloadJson,
      responseCode: res.responseCode ?? undefined,
      responseBody: res.responseBody ?? undefined,
      durationMs: res.durationMs,
      error: res.ok ? undefined : res.error ?? "error",
      createdAtMs: Date.now(),
    } as any);

    if (res.ok) {
      await db.update(callbackTasks).set({ status: "SUCCESS", attemptCount: attempts, updatedAtMs: Date.now() } as any).where(eq(callbackTasks.id, t.id));
      await markOrderNotify(String(t.orderType), String(t.orderId), "SUCCESS", Date.now());
      return { ok: true, attempts };
    }

    if (attempts >= max) {
      await db
        .update(callbackTasks)
        .set({ status: "FAILED", attemptCount: attempts, lastError: res.error ?? "error", updatedAtMs: Date.now() } as any)
        .where(eq(callbackTasks.id, t.id));
      await markOrderNotify(String(t.orderType), String(t.orderId), "FAILED", Date.now());
      return { ok: false, attempts };
    }

    // Small delay to avoid hammering. No cron needed.
    await new Promise((r) => setTimeout(r, 200));
  }

  return { ok: false, attempts };
}

export async function processDueCallbackTasks(opts: { nowMs: number; limit: number }): Promise<{ processed: number }> {
  const due = await db
    .select()
    .from(callbackTasks)
    .where(and(eq(callbackTasks.status, "PENDING"), lte(callbackTasks.nextAttemptAtMs, opts.nowMs)))
    .limit(opts.limit);

  let processed = 0;
  for (const t of due as any[]) {
    processed++;
    const start = Date.now();
    let responseCode: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;

    const res = await sendOnce(t, opts.nowMs);
    responseCode = res.responseCode ?? null;
    responseBody = res.responseBody ?? null;
    if (res.ok) {
      await db.update(callbackTasks).set({ status: "SUCCESS", updatedAtMs: Date.now() } as any).where(eq(callbackTasks.id, t.id));
      await markOrderNotify(String(t.orderType), String(t.orderId), "SUCCESS", opts.nowMs);
    } else {
      error = res.error ?? "error";
      const nextAttempt = Number(t.attemptCount ?? 0) + 1;
      const max = Number(t.maxAttempts ?? 5);
      if (nextAttempt >= max) {
        await db
          .update(callbackTasks)
          .set({
            status: "FAILED",
            attemptCount: nextAttempt,
            lastError: error,
            updatedAtMs: Date.now(),
          } as any)
          .where(eq(callbackTasks.id, t.id));
        await markOrderNotify(String(t.orderType), String(t.orderId), "FAILED", opts.nowMs);
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
          } as any)
          .where(eq(callbackTasks.id, t.id));
        await markOrderNotify(String(t.orderType), String(t.orderId), "PENDING", opts.nowMs);
      }
    }
    {
      const durationMs = res.durationMs ?? (Date.now() - start);
      await db.insert(callbackAttempts).values({
        id: id("cba"),
        taskId: t.id,
        requestBody: t.payloadJson,
        responseCode: responseCode ?? undefined,
        responseBody: responseBody ?? undefined,
        durationMs,
        error: error ?? undefined,
        createdAtMs: Date.now(),
      } as any);
    }
  }

  return { processed };
}
