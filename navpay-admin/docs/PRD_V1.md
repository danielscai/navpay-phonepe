# NavPay 管理后台 PRD (V1)

## 1. 目标
- 交付一个可运行的后台管理系统，覆盖：登录与 2FA、商户与订单、回调队列、系统配置、Webhook 外部请求模拟、基础报表与审计入口。
- V1 使用 SQLite；数据与代码结构需支持未来迁移到 Postgres。

## 2. 用户与角色
- 角色：超级管理员、运营、财务、审核员、只读。
- 权限模型：RBAC（Role -> Permission -> User）。

### 2.1 高危操作(默认仅超级管理员)
- 手动将代付订单置为 SUCCESS/FAILED/REJECTED
- 重置商户密钥
- 修改费率、限额、关键系统参数

## 3. 核心业务对象
- 商户：基础信息、启用状态、余额、代付冻结余额、费率、API Key
- 订单：
  - 代收订单：merchantOrderNo、amount、fee、status、notifyUrl
  - 代付订单：merchantOrderNo、amount、fee、status、notifyUrl、收款人信息
- 回调任务：payloadJson、signature、重试信息、状态
- Webhook 接收器：用于模拟外部回调接收端

## 4. 核心流程

### 4.1 登录与 2FA
1. 用户输入用户名/密码
2. 系统校验强密码、失败次数与锁定窗口
3. 登录成功后判断 2FA 状态：
4. 若用户已启用 2FA：提示输入 TOTP 验证码完成登录
5. 若用户未启用但被要求绑定(首次/策略)：允许先登录建立会话，然后强制跳转到 2FA 绑定页，绑定完成后才允许进入后台功能页
6. 若无需 2FA：直接进入后台

### 4.2 代收闭环
1. 创建代收订单 -> `CREATED`
2. 修改状态为 `PENDING_PAY / PAID / SUCCESS / FAILED`
3. 进入 `SUCCESS` 时结算：商户余额 += amount - fee
4. 每次状态更新可产生回调任务
5. 运行 callback worker 发送回调到 notifyUrl
6. Webhook 模拟器记录收到的 payload

### 4.3 代付闭环
1. 创建代付订单 -> `REVIEW_PENDING`，冻结余额 = amount + fee，并从余额扣除
2. 审核流转：`APPROVED` -> `BANK_CONFIRMING` -> `SUCCESS`
3. `SUCCESS`：释放冻结（余额不再变）
4. `FAILED/REJECTED/EXPIRED`：余额退款并释放冻结
5. 每次状态更新可产生回调任务，worker 发送回调

## 5. 状态机

### 5.1 代收状态
- `CREATED` -> `PENDING_PAY` -> `PAID` -> `SUCCESS`
- `CREATED/PENDING_PAY/PAID` -> `FAILED`
- `CREATED/PENDING_PAY` -> `EXPIRED`
- 约束：进入 `SUCCESS` 后不可回退（V1 防止重复记账）

### 5.2 代付状态
- `REVIEW_PENDING` -> `APPROVED` -> `BANK_CONFIRMING` -> `SUCCESS`
- `REVIEW_PENDING/APPROVED/BANK_CONFIRMING` -> `FAILED/REJECTED/EXPIRED`
- 约束：进入 `SUCCESS` 后不可回退（V1）

## 6. 回调与签名
- Payload：JSON（包含 type、orderId、merchantId、merchantOrderNo、amount、fee、status、ts）
- 签名：`HMAC-SHA256`，输出 base64，header `x-navpay-signature`
- 重试：最多 5 次，指数退避（60s, 120s, 240s...）

## 7. 安全设计
- 强密码策略：>=12，含大小写/数字/符号
- 登录失败锁定：连续 5 次失败锁定 15 分钟
- CSRF：双提交 cookie `np_csrf` + header `x-csrf-token`
- 安全响应头：CSP、XFO、nosniff 等
- 2FA：Google Authenticator TOTP，绑定后生成备用恢复码

## 8. 数据库与迁移
- ORM：Drizzle
- V1：SQLite (`file:./data/dev.db`)
- 迁移：drizzle-kit 生成 SQL + 应用层 migration runner
- 未来：新增 Postgres schema 与迁移策略，保持 ID/金额字段可迁移

## 9. 假设与可配置项
- 金额精度：INR 2 位；USDT 6 位展示
- 手续费：bps + 最低手续费，四舍五入
- 时区：默认中文界面；支持切换到 `Asia/Kolkata`
