# 支付渠道与支付个人（管理文档）

本文用于统一管理“代收/代付订单与支付渠道（支付个人）”的业务逻辑、状态流转与实现位置，避免后续改动接口或页面后出现行为不一致。

## 目标

- 代收订单生成后，自动分配给平台内“余额充足”的支付个人接单处理。
- 代付订单生成后，支付个人通过“抢单/锁单”方式处理，锁单有 10 分钟默认超时（可配置），超时自动释放给其他人。
- 订单进入终态（成功/失败/超时等）后，应立即触发回调通知（最大重试次数可配置）。

## 核心实体

### 支付个人（Payment Person）

- 表：`payment_persons`
- 余额流水表：`payment_person_balance_logs`
- 账号体系：
  - 新增支付个人时，会同时创建一条平台 `users` 账号，并写入 `payment_persons.user_id`。
  - 可在创建时手动指定 `username/password`；也可留空，由系统随机生成（密码为强密码）。
  - 初始密码仅在创建成功时返回一次，用于管理员交付给支付个人。

相关代码：
- 余额调整/记账：`navpay-admin/src/lib/payment-person.ts`
- 后台管理 UI：`navpay-admin/src/components/payment-persons-client.tsx`

## 支付渠道（当前实现）

目前仅实现 1 个渠道：`个人网银 APP`（后续可通过 Tab 扩展更多渠道）。

后台入口：
- 管理后台：`/admin/payout/channels`
- 调试工具：`/admin/tools/payment-persons`

相关资源管理入口（独立页面）：
- 手机设备列表：`/admin/resources/devices`
- 网银账户列表：`/admin/resources/bank-accounts`

## 调试工具：个人支付渠道登录模拟与上报

目的：在没有真实手机 App 的情况下，快速生成并“上报”设备/App/交易记录数据，用于联调后台展示与订单分配/锁单流程。

入口：`/admin/tools/payment-persons`

流程：
1. 在“个人支付渠道列表”先创建账号（会生成 username/password）。
2. 打开调试工具“个人支付渠道”，选择账号。
3. 点击“模拟登录并上报”：
   - 自动生成 2 台手机设备
   - 每台手机安装 2 个支付 App（共 4 个 App 安装记录）
   - 生成 1 个网银账户与若干笔交易记录
   - 自动写入服务端数据库
4. 回到“个人支付渠道列表”，点击“历史与详情”，即可看到手机在线、安装 App、交易记录等信息。

相关实现：
- 生成计划（纯函数，便于测试）：`navpay-admin/src/lib/personal-channel-sim.ts`
- 调试工具前端：`navpay-admin/src/components/personal-channel-simulator-client.tsx`

### 真实登录与上报接口（供手机 App / 模拟器使用）

- 登录：`POST /api/personal/auth/login` -> `{ token }`
- 登出：`POST /api/personal/auth/logout`（`Authorization: Bearer <token>`）
- 上报：`POST /api/personal/report/sync`（`Authorization: Bearer <token>`）

上报后可在“个人支付渠道详情页”的下列 Tab 中查看：
- 手机详情：设备与安装 App
- 网银账户：账户列表
- 网银交易记录：分页
- 余额变动历史：分页
- 账户详情：登录记录 + 上报日志（分页）

## 代收订单（Collect）分配逻辑

触发点：代收订单创建成功后（无论是后台调试创建，还是商户 API 创建）。

规则（当前版本最小闭环）：
- 从启用的支付个人中，选择第一个满足 `payment_person.balance >= order.amount` 的人；
- 写入 `collect_orders.assigned_payment_person_id` 与 `collect_orders.assigned_at_ms`；
- 如果没有满足条件的人，则不分配（保留为空）。

实现位置：
- 后台调试创建：`navpay-admin/src/app/api/admin/orders/collect/route.ts`
- 商户 API v1 创建：`navpay-admin/src/app/api/v1/collect/orders/route.ts`
- 选人逻辑：`navpay-admin/src/lib/payment-person.ts`

展示位置：
- 订单列表/详情/调试工具列表都会展示 `支付个人: xxx`。

## 代付订单（Payout）抢单/锁单逻辑

### 状态与语义

- `APPROVED`：待抢单（可被支付个人锁定处理）
- `LOCKED`：已锁单处理中（锁定到期后自动释放回 `APPROVED`，仅 AUTO 锁单）

状态中文与颜色映射（单一来源）：
- `navpay-admin/src/lib/order-status.ts`
- 颜色规范：`navpay-admin/docs/UI_STATUS_COLORS.md`

### 锁单字段

在 `payout_orders` 上记录：
- `locked_payment_person_id`
- `lock_mode`：`AUTO | MANUAL`
- `locked_at_ms`
- `lock_expires_at_ms`

### 锁单/解锁操作（管理后台/调试）

- 锁单：`POST /api/admin/orders/payout/:orderId/lock`
  - 仅允许 `APPROVED` -> `LOCKED`
  - 自动计算 `lock_expires_at_ms = now + payout.lock_timeout_minutes`
- 解锁：`POST /api/admin/orders/payout/:orderId/unlock`
  - `LOCKED` -> `APPROVED`

### 自动释放（避免长期占用）

- 仅 `AUTO` 锁单会自动释放
- sweep 触发点：代付订单列表接口 GET 时会调用 sweep

实现位置：
- sweep：`navpay-admin/src/lib/payout-lock.ts`
- 列表接口：`navpay-admin/src/app/api/admin/orders/payout/route.ts`、`navpay-admin/src/app/api/merchant/orders/payout/route.ts`

## 回调通知

订单进入终态后，应立即触发一次回调通知，不依赖 cron。

配置项：
- `callback.max_attempts`：最大重试次数（含首次发送），默认 3

实现位置：
- 立即派发：`navpay-admin/src/lib/callback-dispatch.ts`
- 终态触发点：各状态更新/支付页模拟/超时 sweep 内部会 enqueue + immediate dispatch

## 配置项（System Config）

- `order.timeout_minutes`：订单超时（代收/代付统一），默认 10 分钟
- `payout.lock_timeout_minutes`：代付锁单超时，默认 10 分钟
- `callback.max_attempts`：回调最大重试次数，默认 3

## 数据库变更（迁移）

- `drizzle/0004_payment_persons_and_order_locks.sql`
- `drizzle/0005_payment_person_user.sql`
