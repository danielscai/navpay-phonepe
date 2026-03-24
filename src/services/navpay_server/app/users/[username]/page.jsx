import Link from "next/link";
import { formatInIST, getOrdersForUser, getUser, refreshExpiredClaims } from "../../../lib/store.js";

export const dynamic = "force-dynamic";

export default function UserDetailPage({ params }) {
  refreshExpiredClaims();
  const user = getUser(params.username);

  if (!user) {
    return (
      <section className="panel">
        <p>用户不存在</p>
        <Link className="row-link" href="/">返回用户列表</Link>
      </section>
    );
  }

  const userOrders = getOrdersForUser(user.username);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">用户详情</h1>
          <p className="page-subtitle">账号与抢单记录细节。</p>
        </div>
      </div>

      <section className="panel">
        <div className="card-grid">
          <div className="info-card">
            <div className="info-title">User</div>
            <div className="info-value">{user.name}</div>
            <div className="meta">{user.username}</div>
          </div>
          <div className="info-card">
            <div className="info-title">Phone</div>
            <div className="info-value">{user.phone}</div>
            <div className="meta">{user.email}</div>
          </div>
          <div className="info-card">
            <div className="info-title">Claim Failures</div>
            <div className="info-value">{user.claimFailures.length}</div>
            <div className="meta">最近未完成释放</div>
          </div>
        </div>

        <div className="pager" style={{ marginTop: "18px" }}>
          <Link href="/">返回用户列表</Link>
        </div>
      </section>

      <section className="panel" style={{ marginTop: "20px" }}>
        <h2 className="page-title" style={{ fontSize: "22px" }}>订单明细</h2>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Amount</th>
              <th>Status</th>
              <th>App</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {userOrders.length > 0 ? (
              userOrders.map((o) => (
                <tr key={o.id}>
                  <td className="row-link">{o.id}</td>
                  <td>{o.amount} {o.currency}</td>
                  <td><span className={`pill ${o.status}`}>{o.status}</span></td>
                  <td>{o.paymentApp}</td>
                  <td>{formatInIST(o.createdAt)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>暂无订单</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel" style={{ marginTop: "20px" }}>
        <h2 className="page-title" style={{ fontSize: "22px" }}>抢单未完成记录</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Claimed At</th>
              <th>Released At</th>
            </tr>
          </thead>
          <tbody>
            {user.claimFailures.length > 0 ? (
              user.claimFailures.map((f) => (
                <tr key={`${f.orderId}-${f.releasedAt}`}>
                  <td className="row-link">{f.orderId}</td>
                  <td>{formatInIST(f.claimedAt)}</td>
                  <td>{formatInIST(f.releasedAt)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3}>暂无记录</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
