import Link from "next/link";
import { formatInIST, getOrders, paginate, refreshExpiredClaims } from "../../lib/store.js";

export const dynamic = "force-dynamic";

export default function OrdersPage({ searchParams }) {
  refreshExpiredClaims();
  const page = parseInt(searchParams?.page || "1", 10);
  const size = parseInt(searchParams?.size || "10", 10);
  const orders = getOrders();
  const { items, current, totalPages, total } = paginate(orders, page, size);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">订单列表</h1>
          <p className="page-subtitle">订单状态、归属与时间线概览。</p>
        </div>
      </div>

      <section className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Amount</th>
              <th>Currency</th>
              <th>Status</th>
              <th>App</th>
              <th>User</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.length > 0 ? (
              items.map((o) => (
                <tr key={o.id}>
                  <td className="row-link">{o.id}</td>
                  <td>{o.amount}</td>
                  <td>{o.currency}</td>
                  <td><span className={`pill ${o.status}`}>{o.status}</span></td>
                  <td>{o.paymentApp}</td>
                  <td>{o.assignedTo || "-"}</td>
                  <td>{formatInIST(o.createdAt)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>暂无数据</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="pager">
          <span className="meta">共 {total} 条</span>
          {current > 1 ? (
            <Link href={`/orders?page=${current - 1}&size=${size}`}>上一页</Link>
          ) : null}
          <span className="meta">第 {current} / {totalPages} 页</span>
          {current < totalPages ? (
            <Link href={`/orders?page=${current + 1}&size=${size}`}>下一页</Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
