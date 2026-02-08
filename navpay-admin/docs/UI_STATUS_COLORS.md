# 订单状态颜色规范

背景：页面上状态标签使用 `.np-pill` 体系。`.np-pill` 在 `navpay-admin/src/app/globals.css` 里定义了默认的灰色边框/背景/文字颜色，因此如果仅在组件里写 `text-* / bg-* / border-*`，很容易被 `.np-pill` 覆盖，导致除了 `.np-pill-ok`（绿色）之外看起来都“发灰”。

为保证视觉一致和可维护性，状态颜色必须使用下列全局变体类：

- 基础：`np-pill`
- 成功：`np-pill-ok`
- 信息：`np-pill-info`
- 警告：`np-pill-warn`
- 错误：`np-pill-danger`
- 关闭/不可用：`np-pill-off`

## 代收（Collect）状态映射

- `CREATED`：已创建，`np-pill np-pill-info`
- `PENDING_PAY`：支付中，`np-pill np-pill-warn`
- `PAID`：已支付，`np-pill np-pill-info`
- `SUCCESS`：成功，`np-pill np-pill-ok`
- `FAILED`：失败，`np-pill np-pill-danger`
- `EXPIRED`：已过期，`np-pill np-pill-danger`

## 代付（Payout）状态映射

- `CREATED`：已创建，`np-pill np-pill-info`
- `REVIEW_PENDING`：待审核，`np-pill np-pill-warn`
- `APPROVED`：待抢单，`np-pill np-pill-info`
- `LOCKED`：处理中，`np-pill np-pill-warn`
- `BANK_CONFIRMING`：银行处理中，`np-pill np-pill-info`
- `SUCCESS`：成功，`np-pill np-pill-ok`
- `FAILED`：失败，`np-pill np-pill-danger`
- `REJECTED`：已拒绝，`np-pill np-pill-danger`
- `EXPIRED`：已过期，`np-pill np-pill-danger`

## 代码引用

- 订单模拟器：`navpay-admin/src/components/order-simulator-client.tsx`
- 代收支付页（调试）：`navpay-admin/src/components/collect-pay-page-client.tsx`
- 状态映射（单一来源）：`navpay-admin/src/lib/order-status.ts`
- 样式定义：`navpay-admin/src/app/globals.css`

## 通知状态（回调是否已发送）

订单列表会展示 `notifyStatus`（单一来源同样在 `navpay-admin/src/lib/order-status.ts`）：

- `PENDING`：待通知（黄）
- `SUCCESS`：已通知（绿）
- `FAILED`：通知失败（红）
