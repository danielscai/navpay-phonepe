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
- 佣金/返利流水表：`payment_person_commission_logs`（今日收益、团队返利等统计来源）
- 账号体系：
  - 新增支付个人时，会同时创建一条平台 `users` 账号，并写入 `payment_persons.user_id`。
  - 可在创建时手动指定 `username/password`；也可留空，由系统随机生成（密码为强密码）。
  - 初始密码仅在创建成功时返回一次，用于管理员交付给支付个人。
 - 邀请关系（上级/下级）：
   - `payment_persons.invite_code`：6 位字母数字邀请码（用于绑定上级）。
   - `payment_persons.inviter_person_id`：上级 payment person（创建时绑定，关系不可变）。

相关代码：
- 余额调整/记账：`navpay-admin/src/lib/payment-person.ts`
- 后台管理 UI：`navpay-admin/src/components/payment-persons-client.tsx`
- 团队返利/佣金结算：`navpay-admin/src/lib/channel-commission.ts`

## 今日收益与团队返利（V1）

### 统计口径

- 今日：固定按印度时间 `Asia/Kolkata` 的自然日统计（与后台展示时区切换无关）。
- 完成口径：订单状态为 `SUCCESS`。
- 代收/代付分别统计，并提供合计。

### 订单费率（渠道收益 fee）

- 新增字段：
  - `collect_orders.channel_fee`
  - `payout_orders.channel_fee`
- 默认比例：4.5%（可在系统参数配置，单位 bps）：
  - `channel.fee_rate_bps` 默认 `450`

### 多级返利

- 返利按订单 `amount` 的固定比例实时结算，最多 3 级：
  - 一级(直接上级)：`channel.rebate_l1_bps` 默认 `50`（0.5%）
  - 二级：`channel.rebate_l2_bps` 默认 `30`（0.3%）
  - 三级：`channel.rebate_l3_bps` 默认 `10`（0.1%）
- 返利流水写入 `payment_person_commission_logs`，并通过唯一键确保幂等（同一订单不会重复记账）。

## 支付渠道（当前实现）

目前仅实现 1 个渠道：`个人网银 APP`（后续可通过 Tab 扩展更多渠道）。

后台入口：
- 管理后台：`/admin/payout/channels`
- 调试工具：`/admin/tools/payment-persons`

相关资源管理入口（独立页面）：
- 资源管理（手机/网银账户 Tab）：`/admin/resources`

## 调试工具：个人支付渠道登录模拟与上报

目的：在没有真实手机 App 的情况下，快速生成并“上报”设备/App/交易记录数据，用于联调后台展示与订单分配/锁单流程。

入口：`/admin/tools/payment-persons`

流程：
1. 在“个人支付渠道列表”先创建账号（会生成 username/password）。
2. 打开调试工具“个人支付渠道”，选择账号。
3. 输入密码并点击“登录”（真实调用接口 `POST /api/personal/auth/login`）。
4. 切换到“上报数据”Tab，点击“上报模拟数据”：
   - 自动生成 N 台手机设备（可配置）
   - 每台手机安装 2 个支付 App（共 2N 个 App 安装记录）
   - 生成 M 个网银账户（可配置）与若干笔交易记录（支持自定义 JSON）
   - 自动写入服务端数据库
5. 回到“个人支付渠道列表”，点击“用户名”进入详情，即可看到手机在线、安装 App、交易记录等信息。

相关实现：
- 生成计划（纯函数，便于测试）：`navpay-admin/src/lib/personal-channel-sim.ts`
- 调试工具前端：`navpay-admin/src/components/personal-channel-simulator-client.tsx`

### 真实登录与上报接口（供手机 App / 模拟器使用）

- 登录：`POST /api/personal/auth/login` -> `{ token }`
- 登出：`POST /api/personal/auth/logout`（`Authorization: Bearer <token>`）
- 上报：`POST /api/personal/report/sync`（`Authorization: Bearer <token>`）

上报后可在“个人支付渠道详情页”的下列 Tab 中查看：
- 账户详情：余额/状态/快捷入口等汇总
- 手机详情：设备与安装 App
- 网银账户：账户列表
- 交易记录：分页（默认每页 10 条）
- 余额变动：分页（默认每页 10 条）
- 登录记录：分页
- 上报日志：分页（含 登录/登出/上报/抢单/完成 等关键事件）

## 调试工具：代付订单抢单与完成（个人侧）

入口：`/admin/tools/payment-persons` 的 “代付抢单” Tab（需先登录个人账号）。

流程：
1. 管理后台创建代付订单后，将订单审核为 `APPROVED`（待抢单）。
2. 在“代付抢单”中会看到可抢列表（个人接口：`GET /api/personal/payout/orders/available`）。
3. 点击“抢单”会把订单锁定到当前个人（个人接口：`POST /api/personal/payout/orders/:id/claim`），并开始显示倒计时。
4. 点击“模拟成功/模拟失败”完成订单（个人接口：`POST /api/personal/payout/orders/:id/complete`）：
   - 成功：会把 `amount` 入账到个人余额（幂等），并触发回调通知
   - 失败：订单进入失败终态，并触发回调通知

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
- 颜色规范：`navpay-admin/docs/UI_STATUS_COLORS.md`（同仓库内文件：`docs/UI_STATUS_COLORS.md`）

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
