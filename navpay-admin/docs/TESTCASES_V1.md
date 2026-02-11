# NavPay 管理后台 测试用例 (V1)

以下用例按“场景驱动”组织，可复测并可自动化。

## TC-001 强制 2FA 首次登录闭环
- 前置条件：数据库已 seed（存在 `admin / NavPay@123456!`，且 `totpMustEnroll=true`）。
- 步骤：
1. 打开 `/auth/login`
2. 输入用户名/密码提交
3. 跳转到 `/auth/2fa/enroll`
4. 扫码或使用 otpauth 手动添加到 Google Authenticator
5. 输入验证码确认绑定
6. 记录并保存备用恢复码
7. 绑定成功后点击「进入后台」，进入 `/admin`
8. 退出登录，返回 `/auth/login`，再次登录（此时会进入 OTP 步骤，需要输入验证码/恢复码）
- 期望：
- 首次登录允许用户名/密码登录，但会被强制引导到 2FA 绑定页面
- 绑定后可以进入后台
- 再次登录会进入 OTP 步骤，输入验证码/恢复码后登录成功
- 备用恢复码生成并展示

## TC-001A 固定 2FA 的 QA 登录（用于自动化）
- 前置条件：数据库已 seed（存在 `qa / NavPayQA@123456!`，且已启用固定 2FA）。
- 步骤：
1. 打开 `/auth/login`
2. 输入用户名/密码提交
3. 输入 `Google Authenticator 验证码 / 备用恢复码` 并登录
- 期望：
- 成功进入 `/admin`
- 不会触发 2FA 绑定页面（`totpMustEnroll=false`）

## TC-002 创建商户
- 前置条件：已登录为超级管理员
- 步骤：
1. 进入 `/admin/merchants`
2. 输入商户号/名称并创建
3. 刷新列表
- 期望：
- 商户出现在列表，默认启用，余额为 0
- 自动创建费率记录

## TC-003 代收订单全链路（含回调）
- 前置条件：已登录；已创建 Webhook 接收器（拿到 receiverId）
- 步骤：
1. 进入 `/admin/tools/webhook-simulator` 创建接收器，复制接收 URL
2. 进入 `/admin/orders/collect` 创建代收订单（notifyUrl 指向接收 URL）
3. 将订单状态更新为 `SUCCESS`（会生成回调任务）
4. 进入 `/admin/callbacks` 执行回调 worker
5. 回到 Webhook 模拟器查看事件
- 期望：
- 回调任务从 PENDING -> SUCCESS
- Webhook 模拟器收到 1 条事件，body 为订单回调 payload

## TC-004 代付订单全链路（冻结余额、审核、回调）
- 前置条件：商户余额充足；已创建 Webhook 接收器
- 步骤：
1. 进入 `/admin/orders/payout` 创建代付订单（notifyUrl 指向接收 URL）
2. 检查商户余额减少、冻结增加（amount+fee）
3. 状态依次：`APPROVED` -> `BANK_CONFIRMING` -> `SUCCESS`
4. 进入 `/admin/callbacks` 执行回调 worker
5. Webhook 模拟器查看事件
- 期望：
- 创建时冻结正确
- SUCCESS 后冻结释放
- 回调任务成功发送并被接收

## TC-005 CSRF 防护（API）
- 前置条件：已登录
- 步骤：
1. 直接调用 POST API（不带 `x-csrf-token`）
2. 再调用一次（带 token）
- 期望：
- 不带 token 返回 403
- 带 token 成功

## TC-006 登录锁定
- 前置条件：存在 admin 用户
- 步骤：
1. 连续 5 次输入错误密码提交
2. 第 6 次使用正确密码提交
- 期望：
- 账号被锁定 15 分钟（返回 locked/429）

## TC-007 时区切换（展示）
- 前置条件：已登录；订单列表中存在记录（代收/代付/通知队列均可）
- 步骤：
1. 在侧边栏顶部时区下拉选择 `印度 (Asia/Kolkata)`
2. 进入 `代收订单` 或 `通知队列` 页面，查看 `创建时间/下次尝试` 显示
3. 切回 `中国 (Asia/Shanghai)`，重复查看
- 期望：
- 切换后页面刷新生效
- 同一条记录在不同时区下展示的时间不同（仅展示变化，底层时间戳不变）

## TC-008 Passkey 绑定与登录（WebAuthn）
- 前置条件：已登录；浏览器支持 WebAuthn（桌面 Chrome/Safari/Edge 等均可）
- 步骤：
1. 进入 `/admin/account`
2. 点击「添加 Passkey」并完成系统/浏览器弹窗验证
3. 退出登录
4. 进入 `/auth/login`，输入用户名，点击「使用 Passkey 登录」
- 期望：
- Passkey 可成功绑定并出现在列表
- 可使用 Passkey 登录进入 `/admin`

## TC-009 支付账户：邀请码上下级 + 今日收益 + 多级返利
- 前置条件：已登录；系统参数存在默认值（`channel.fee_rate_bps=450`，`channel.rebate_l1_bps=50`，`channel.rebate_l2_bps=30`，`channel.rebate_l3_bps=10`）。
- 步骤：
1. 进入 `/admin/payout/channels`
2. 新增 3 个支付账户 A、B、C
3. 创建 B 时填写 A 的邀请码；创建 C 时填写 B 的邀请码
4. 进入 `/admin/tools/order-simulator` 创建一笔代收订单并支付成功（确保分配给 C）
5. 打开 C 详情页（`/admin/payout/payment-persons/:id?tab=account`），查看“今日收益(费)”展示
6. 打开 B/A 详情页（`tab=account` 或 `tab=team`），查看“今日团队返利”
- 期望：
- C 的今日收益包含该订单 `channel_fee`（按 4.5% 计算）
- B 获得一级返利（0.5% * amount），A 获得二级返利（0.3% * amount）
- 统计按 `Asia/Kolkata` 当日自然日计算
- 扣钱操作不会导致余额为负，并且必须填写原因

## TC-010 系统能力：平台用户 + 角色权限（手工验证）
- 前置条件：使用具备 `system.read`/`system.write` 的账号登录后台。
- 步骤：
1. 进入 `/admin/system/roles`，新增角色并设置权限（勾选/取消勾选）。
2. 进入 `/admin/system/users`，新增平台用户并分配角色。
3. 使用新平台用户登录，确认其页面访问权限与所分配权限一致（无权限页面返回 403/提示）。
- 期望：
- 角色权限可增删改（被用户使用中的角色不允许删除）
- 平台用户可新增/删除/分配角色（不允许删除自己）

## TC-011 运营设置：支付APP管理（手工验证）
- 前置条件：使用具备 `system.read`/`system.write` 的账号登录后台。
- 步骤：
1. 进入 `/admin/ops/settings?tab=payment_apps`
2. 新增支付APP（名称/包名/versionCode/下载地址/最小支持版本）
3. 在列表中切换 “启用/代收/代付” 开关，并编辑/删除
- 期望：
- 列表在桌面与移动端均无横向溢出
- 开关与编辑结果刷新后可持久化
