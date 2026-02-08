import { db } from "@/lib/db";
import { merchants, collectOrders, payoutOrders, callbackTasks } from "@/db/schema";

export default async function AdminHome() {
  const mchCount = (await db.select().from(merchants)).length;
  const collectCount = (await db.select().from(collectOrders)).length;
  const payoutCount = (await db.select().from(payoutOrders)).length;
  const cbPending = (await db.select().from(callbackTasks)).filter((x) => x.status === "PENDING").length;

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="np-card p-4">
          <div className="text-xs text-[var(--np-faint)]">商户</div>
          <div className="mt-2 text-2xl font-semibold">{mchCount}</div>
        </div>
        <div className="np-card p-4">
          <div className="text-xs text-[var(--np-faint)]">代收订单</div>
          <div className="mt-2 text-2xl font-semibold">{collectCount}</div>
        </div>
        <div className="np-card p-4">
          <div className="text-xs text-[var(--np-faint)]">代付订单</div>
          <div className="mt-2 text-2xl font-semibold">{payoutCount}</div>
        </div>
        <div className="np-card p-4">
          <div className="text-xs text-[var(--np-faint)]">待回调</div>
          <div className="mt-2 text-2xl font-semibold">{cbPending}</div>
        </div>
      </div>
    </div>
  );
}
