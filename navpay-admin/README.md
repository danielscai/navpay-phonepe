# NavPay 管理后台 (V1)

Next.js 16 + SQLite 的“金融级后台”演示实现，覆盖登录与 2FA、RBAC、商户与订单、回调队列、Webhook 外部请求模拟、基础安全防护与可复测测试用例。

## 目录
- PRD: `navpay-admin/docs/PRD_V1.md`
- 测试用例: `navpay-admin/docs/TESTCASES_V1.md`
- 测试报告: `navpay-admin/docs/TEST_REPORT_V1.md`

## 技术栈
- Next.js (App Router) + React
- DB: SQLite（未来迁移 Postgres）
- ORM: Drizzle + better-sqlite3
- Auth: NextAuth Credentials + Google Authenticator TOTP 2FA
- Test: Vitest + Playwright
- UI: Tailwind v4 (NavPay 金融风格)

## 快速开始
```bash
cd navpay-admin
yarn install
cp .env.example .env
yarn db:migrate
yarn db:seed
yarn dev
```

默认账号（seed 生成）:
- 用户名: `admin`
- 密码: `NavPay@123456!`
- 首次登录会强制绑定 2FA（Google Authenticator）

商户后台账号（seed 生成）:
- 用户名: `merchant`
- 密码: `NavPayMerchant@123456!`
- 登录后进入 `/merchant`（仅可查看自身 API Key/限额/订单/余额/操作日志，并可配置 API 调用 IP 白名单）

测试账号（seed 生成，自动化测试专用）:
- 用户名: `qa`
- 密码: `NavPayQA@123456!`
- 首次登录会强制绑定 2FA（Google Authenticator）

## 环境变量
见 `navpay-admin/.env.example`
- `DATABASE_URL`：`file:./data/dev.db`
- `AUTH_SECRET`：NextAuth session 签名密钥
- `TOTP_ENCRYPTION_KEY`：用于加密存储用户 2FA secret
- `APIKEY_ENCRYPTION_KEY`：用于加密存储商户 API Key
- `DEFAULT_TIMEZONE`：默认 `Asia/Shanghai`，可在 UI 切换到 `Asia/Kolkata`

## 常用命令
```bash
cd navpay-admin
yarn db:migrate
yarn db:seed
yarn db:reset2fa admin
yarn build
yarn test
yarn test:e2e
yarn test:report
```

## 安全设计（V1）
- 强密码策略（>=12 且包含大小写/数字/符号）
- 登录失败限速/锁定（5 次失败锁定 15 分钟）
- CSRF: 双提交 cookie `np_csrf` + header `x-csrf-token`
- 安全响应头：`navpay-admin/next.config.ts`
- RBAC：Role -> Permission -> User（API 侧强制鉴权）
- 2FA：Google Authenticator TOTP（绑定后才允许建立会话）

## 外部请求模拟
- Webhook 接收端: `POST /api/webhook/receive/:receiverId`
- 后台工具：`/admin/tools/webhook-simulator` 创建接收器并查看事件

## Merchant API 文档（公开，无需登录）
- 文档入口：`/docs/merchant-api`
- 代收下单：`/docs/merchant-api/collect`（PDF：`/docs/merchant-api/collect.pdf`）
- 代付下单：`/docs/merchant-api/payout`（PDF：`/docs/merchant-api/payout.pdf`）

## 迁移到 Postgres（预留）
当前 ORM 与 schema 设计保持可迁移：
- 使用 Drizzle（SQLite/Postgres 双支持）
- 金额字段使用字符串/Decimal 表示，避免浮点误差
- 后续只需新增 Postgres connection 与迁移策略（PRD 中有约束）
