# NavPay 管理后台 测试报告 (V1)

生成日期：2026-02-09

## 环境
- Node: v23.10.0
- Next.js: 16.1.6
- DB: SQLite（E2E 使用 `data/test.db`，运行前会重建）

## 执行命令
```bash
cd navpay-admin
yarn test:report
```

## 结果摘要
- build: 通过（12.0s）
- unit: 通过（946ms）
- e2e: 通过（34.5s）

## 覆盖场景
- 强制 2FA 首次登录与绑定（Google Authenticator TOTP）
- Passkey(WebAuthn) 绑定与登录（虚拟验证器自动化）
- 渠道账户邀请码上下级 + 今日收益(India) + 多级返利（代收 SUCCESS 实时结算）
- 创建 Webhook 接收器并获取接收 URL
- 在「调试工具 -> 订单模拟器」创建代收订单、推进状态为 SUCCESS、生成回调任务、执行回调 worker、Webhook 接收端收到 payload
- 在「调试工具 -> 订单模拟器」创建代付订单、冻结余额、审核流转、生成回调任务、执行回调 worker、Webhook 接收端收到 payload

## 产物
- 详细日志：`navpay-admin/test-results/test-report-2026-02-09.log`
- 测试用例：`navpay-admin/docs/TESTCASES_V1.md`

## 结论
- 本次测试全通过。
