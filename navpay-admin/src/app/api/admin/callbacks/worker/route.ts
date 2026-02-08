import { NextResponse, type NextRequest } from "next/server";
import { processDueCallbackTasks } from "@/lib/callback-dispatch";
import { requireApiPerm } from "@/lib/api";
import { env } from "@/lib/env";
import { writeAuditLog } from "@/lib/audit";

export async function POST(req: NextRequest) {
  if (!env.ENABLE_DEBUG_TOOLS) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const { uid } = await requireApiPerm(req, "callback.retry");

  const now = Date.now();
  const { processed } = await processDueCallbackTasks({ nowMs: now, limit: 20 });

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
