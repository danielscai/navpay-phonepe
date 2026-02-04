import Link from "next/link";
import { getOrders, getUsers, paginate, refreshExpiredClaims } from "../lib/store.js";

export const dynamic = "force-dynamic";

export default function UsersPage({ searchParams }) {
  refreshExpiredClaims();
  const page = parseInt(searchParams?.page || "1", 10);
  const size = parseInt(searchParams?.size || "10", 10);
  const users = getUsers();
  const { items, current, totalPages, total } = paginate(users, page, size);
  const orders = getOrders();

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">用户列表</h1>
          <p className="page-subtitle">核心操作员与抢单失败记录汇总。</p>
        </div>
      </div>

      <section className="stats">
        <div className="stat-card">
          <div className="stat-label">总用户</div>
          <div className="stat-value">{users.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">总订单</div>
          <div className="stat-value">{orders.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">开放订单</div>
          <div className="stat-value">{orders.filter((o) => o.status === "UNASSIGNED").length}</div>
        </div>
      </section>

      <section className="panel">
        <table className="table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Name</th>
              <th>Phone</th>
              <th>Email</th>
              <th>Claim Failures</th>
            </tr>
          </thead>
          <tbody>
            {items.length > 0 ? (
              items.map((u) => (
                <tr key={u.username}>
                  <td>
                    <Link className="row-link" href={`/users/${u.username}`}>
                      {u.username}
                    </Link>
                  </td>
                  <td>{u.name}</td>
                  <td>{u.phone}</td>
                  <td>{u.email}</td>
                  <td>{u.claimFailures.length}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>暂无数据</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="pager">
          <span className="meta">共 {total} 条</span>
          {current > 1 ? (
            <Link href={`/?page=${current - 1}&size=${size}`}>上一页</Link>
          ) : null}
          <span className="meta">第 {current} / {totalPages} 页</span>
          {current < totalPages ? (
            <Link href={`/?page=${current + 1}&size=${size}`}>下一页</Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
