# 订单状态与流转（调试工具）

本项目的订单状态用于演示“创建订单 → 状态变化 → 回调队列”的完整闭环，调试工具页面会将状态以中文+颜色展示，并提供“状态流转”可视化说明。

注意：
- 目前后端并未实现严格的状态机校验（调试环境允许从非成功状态进入终态）。
- 已达到 `SUCCESS` 的订单，后端禁止回退到其他状态（避免重复记账/重复释放冻结资金）。

## 代收（Collect）

### 状态枚举（6 种）

- `CREATED`：已创建
- `PENDING_PAY`：支付中
- `PAID`：已支付
- `SUCCESS`：成功
- `FAILED`：失败（终态）
- `EXPIRED`：已过期（终态）

### 推荐流转路径

`CREATED` → `PENDING_PAY` → `PAID` → `SUCCESS`

### 终态

在调试环境中，`FAILED` / `EXPIRED` 可视为“终态”（通常从非成功状态进入）。

## 代付（Payout）

### 状态枚举（9 种）

- `CREATED`：已创建（演示场景较少用）
- `REVIEW_PENDING`：待审核
- `APPROVED`：待抢单
- `LOCKED`：处理中（已被支付个人锁定）
- `BANK_CONFIRMING`：银行处理中
- `SUCCESS`：成功
- `FAILED`：失败（终态）
- `REJECTED`：已拒绝（终态）
- `EXPIRED`：已过期（终态）

### 推荐流转路径

`REVIEW_PENDING` → `APPROVED` → `LOCKED` → `BANK_CONFIRMING` → `SUCCESS`

补充说明：
- `LOCKED` 默认 10 分钟超时后，会自动释放回 `APPROVED`（仅 AUTO 锁单；MANUAL 需要人工解锁）。

### 终态

`FAILED` / `REJECTED` / `EXPIRED` 视为终态。

## 单一来源（方便统一修改）

- 状态中文/颜色：`navpay-admin/src/lib/order-status.ts`
- 调试工具可视化：`navpay-admin/src/components/order-simulator-client.tsx`
- 流转图组件（RAG 图）：`navpay-admin/src/components/status-flow-rag.tsx`

## 后端相关约束（代码来源）

- 代收状态更新接口：`navpay-admin/src/app/api/admin/orders/collect/[orderId]/status/route.ts`
- 代付状态更新接口：`navpay-admin/src/app/api/admin/orders/payout/[orderId]/status/route.ts`

## 超时机制（10 分钟默认，可配置）

- 配置项（后台系统参数）：`order.timeout_minutes`（默认 `10`，单位：分钟）
  - 管理后台入口：系统设置 → System Config
  - 实现：`navpay-admin/src/lib/order-timeout.ts`
- 说明：超时与是否打开支付页无关，基于 `createdAtMs + timeout` 计算。
