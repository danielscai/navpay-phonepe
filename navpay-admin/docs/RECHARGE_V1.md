# 充值模块（区块链充值）设计文档 v1

目标：为每个商户在每条链分配 1 个充值地址，监听链上充值交易，等待确认数（默认 15）后将充值订单置为成功并为商户余额入账。支持 Tron（默认）与 BSC。提供调试入口可模拟链上事件与确认推进，验证完整链路。

## 术语

- 充值订单：商户向平台充值地址转入资金形成的订单。
- 确认数：`headBlock - txBlock + 1`，达到 `confirmationsRequired` 才入账。
- HD 钱包：通过助记词 + 派生路径（BIP44）生成多地址；平台只存“偏移量/索引”，不在页面展示助记词。

## 数据模型

### 商户表（偏移量）

表：`merchants`

- `deposit_index_tron`：Tron 地址派生 index（偏移量）
- `deposit_index_bsc`：BSC 地址派生 index（偏移量）

说明：满足“只记录偏移量即可”的要求，便于审计与迁移。

### 商户充值地址

表：`merchant_deposit_addresses`

- `merchant_id` + `chain` 唯一
- `chain` + `address` 唯一

用途：持久化分配结果，避免每次都依赖实时派生/计算，同时用于“地址反查商户”。

### 充值订单

表：`recharge_intents`（v1 主业务表）

字段：
- `merchant_id`
- `merchant_order_no`
- `chain`：`tron | bsc`
- `asset`：默认 `USDT`（v1 先按单资产处理）
- `address`：商户充值地址
- `expected_amount`
- `status`：`CREATED | CONFIRMING | SUCCESS | FAILED | EXPIRED`
- `expires_at_ms`：超时点（由 `order.timeout_minutes` 决定）

链上信息（在检测到交易后写入）：
- `tx_hash`（可为空）
- `from_address` / `to_address`
- `block_number`
- `confirmations` / `confirmations_required`（默认 15）
- `credited_at_ms`：入账时间（幂等保护）

唯一约束：
- `(chain, tx_hash)`：防止重复交易重复写入

## 地址分配（HD 派生）

助记词只存储在环境变量中，且加密存储：
- `DEPOSIT_MNEMONIC_ENCRYPTION_KEY`
- `DEPOSIT_MNEMONIC_ENC`（密文）

派生路径：
- Tron：`m/44'/195'/0'/0/<index>`
- BSC（EVM）：`m/44'/60'/0'/0/<index>`

实现：
- 派生与地址转换：`navpay-admin/src/lib/recharge-hd.ts`
- 分配与持久化：`navpay-admin/src/lib/recharge-address.ts`

说明：
- 页面不会展示助记词内容，只会显示“已配置/未配置”状态。
- 每个商户每条链固定 1 个地址（v1 规则）。

### 生成密文（开发/部署辅助）

使用脚本生成 `DEPOSIT_MNEMONIC_ENC`：

```bash
cd navpay-admin
tsx scripts/encrypt-string.ts "your mnemonic words ..." "$DEPOSIT_MNEMONIC_ENCRYPTION_KEY"
```

## 监听与确认（v1）

### 监听策略（架构预留）

生产建议：由独立 Worker 周期性调用链上 API 获取交易（无需自建节点），识别平台地址入金并落库为充值订单。

v1 代码已把核心逻辑抽象为：
- 落库：`upsertRechargeFromTx`（`navpay-admin/src/lib/recharge.ts`）
- 确认推进与入账：`processRechargeConfirmations`（`navpay-admin/src/lib/recharge.ts`）

已提供“无需自建节点”的 API 拉取实现与 worker（可选启用）：
- 链上 API 拉取：`navpay-admin/src/lib/recharge-chain.ts`
- Worker：`navpay-admin/scripts/recharge-worker.ts`（脚本：`yarn recharge:worker`）

环境变量（可选）：
- `TRON_API_BASE` / `TRON_API_KEY`
- `BSCSCAN_API_BASE` / `BSCSCAN_API_KEY`
- `TRON_USDT_CONTRACT` / `TRON_USDT_DECIMALS`（默认 USDT TRC20 合约与 6 位小数）
- `BSC_USDT_CONTRACT` / `BSC_USDT_DECIMALS`（默认 USDT BEP20 合约与 18 位小数）
- `RECHARGE_WORKER_INTERVAL_SEC`（轮询间隔，默认 20 秒）

说明：worker 会把监听游标记录在 `system_configs` 中（内部 key），并依赖订单表去重与入账幂等确保安全。

### 确认数计算

`confirmations = max(0, headBlockNumber - tx.blockNumber + 1)`

当 `confirmations >= confirmationsRequired` 时：
1. `recharge_intents.status = SUCCESS`
2. `recharge_intents.credited_at_ms = now`（仅首次入账时写入）
3. `merchants.balance += amount`（幂等，依赖 `credited_at_ms` 防重复）

## 后台页面

- 管理后台订单：`/admin/orders/recharge`（参考代收/代付列表风格）
- 管理后台配置：`/admin/system/recharge`（启用开关、确认数、钱包配置状态）

## 商户页面

- 充值订单：`/merchant/orders/recharge`
- 充值地址：`/merchant/recharge/addresses`

## 调试入口（模拟链上事件）

入口：`/admin/tools/recharge-simulator`

能力：
1. 第一步：创建充值订单（模拟商户下单，不需要区块链确认）
   - `POST /api/admin/tools/recharge/intents`
2. 第二步：打开订单调试页，模拟链上成功/失败/超时，并推进确认到入账成功
   - 页面：`/admin/tools/recharge-simulator/[intentId]`
   - 接口：`POST /api/admin/tools/recharge/intents/:id/chain-event`、`POST /api/admin/tools/recharge/intents/:id/advance`、`POST /api/admin/tools/recharge/intents/:id/expire`

## 权限

新增权限：
- `order.recharge.read`
- `order.recharge.write`

脚本：
- `navpay-admin/scripts/db-seed.ts`

## 测试范围（v1）

当前仓库单元测试以“纯逻辑”为主（Vitest）。

推荐后续补充：
- 地址派生稳定性与唯一性（同助记词 + index => 同地址）
- 确认推进与入账幂等（多次处理不会重复加余额）
- `tx_hash` 去重（重复事件不会产生重复订单）
