# tstore/v2/units/changes 字段分析（fromTimestamp=0）

## 请求概览
- 方法: `POST`
- 接口: `https://apicp1.phonepe.com/apis/tstore/v2/units/changes`
- 查询参数（从日志还原）:
  - `viewVersion=54`
  - `viewId=phonepeApp__APPView`
  - `size=15`
  - `metaId=U2601181448359012876957`
  - `fromTimestamp=0`
  - `sortOrder=ASC`

> 说明：`fromTimestamp=0` 会从最早记录开始拉取。以上请求在 **2026-02-03** 实际发送并返回 15 条记录。

## 响应结构（顶层）
```json
{
  "code": 200,
  "time": 3,
  "success": true,
  "response": {
    "size": 15,
    "nextPage": "<opaque-token>",
    "changes": [ ... ]
  }
}
```

- `code`: HTTP 语义状态码（示例为 200）。
- `time`: 服务端处理耗时（毫秒级，示例为 3）。
- `success`: 布尔值，表示请求是否成功。
- `response`: 实际数据载体。

## response 字段
- `size`: 本次返回的记录数。
- `nextPage`: 翻页令牌（Base64/opaque token），用于下一页查询。
- `changes`: 交易变更数组。

## changes[]（单条变更）
- `unitId`: 交易或支付单元的全局标识（示例：`T26...`）。
- `createdAt`: 变更创建时间（Unix 毫秒）。
- `updatedAt`: 变更更新时间（Unix 毫秒）。
- `view`: 视图数组，通常包含 1 条交易视图记录。

## view[]（交易视图）
- `type`: 视图类型（不同业务可能不同，样本中未固定）。
- `state`: 视图状态（样本中未固定）。
- `tags`: 标签数组（可能为空）。
- `entityId`: 关联实体 ID（可为空）。
- `errorCode`: 错误码（可为空）。
- `globalPaymentId`: 与 `unitId` 对应的全局支付 ID。
- `createdAt` / `updatedAt`: 视图层级的时间戳。
- `data`: 交易核心数据对象。

## view.data（交易核心数据）
样本中出现的字段集合：
- `context`: 业务上下文（见下文）。
- `paidFrom`: 付款方信息数组。
- `to`: 收款方信息数组或对象。
- `from`: 付款源信息（可选字段，样本中未填充）。
- `sentAt`: 发起时间（Unix 毫秒）。
- `paymentState`: 交易状态（样本：`COMPLETED` / `FAILED`）。
- `responseCode`: 交易响应码（样本：`SUCCESS` / `UPI_BACKBONE_ERROR`）。
- `backendErrorCode`: 后端错误码（可选）。
- `offerAdjustments`: 优惠/抵扣数组（样本中为空数组）。
- `paymentFlags`: 交易标志位数组（样本：`ACCOUNTING_V2`、`UPI_PERSISTENCE_ENABLED` 等）。
- `amount`: 交易金额（数值型，可能是分/paise）。
- `globalPaymentId`: 全局支付 ID（与 `unitId` 一致）。
- `receivedIn`: 收款结果数组（可选字段，样本未出现）。

### context（交易上下文）
- `message`: 交易备注或参考号。
- `tag`: 业务分类（样本：`Miscellaneous`）。
- `transferMode`: 转账模式（样本：`PEER_TO_PEER`）。
- `upiInitiationMode`: UPI 发起模式代码（样本：`00`）。
- `upiPurpose`: UPI 用途码（可选）。
- `custRefId`: 客户侧参考 ID（可选）。
- `originalTransactionId`: 原交易 ID（退款/冲正场景可见）。
- `upiTransactionId`: UPI 网络交易 ID（可选）。
- `serviceContext`: 扩展上下文字段（样本为空对象）。

### paidFrom[]（付款方信息）
- `accountId`: 付款账户 ID。
- `accountNumber`: 付款账户号（样本已脱敏）。
- `accountHolderName`: 账户名。
- `ifsc`: IFSC 码。
- `bankId`: 银行标识。
- `utr`: UTR 号。
- `upiTransactionId`: UPI 交易 ID。
- `vpa`: 付款方 VPA。
- `accountAuthMode`: 认证方式（样本：`UPI`）。
- `accountType`: 账户类型（样本：`SAVINGS`）。
- `type`: 付款方式类型（样本：`ACCOUNT`）。
- `transactionState`: 付款侧状态（样本：`COMPLETED` / `FAILED`）。
- `transactionResponseCode`: 付款侧响应码（样本：`00` / `ZM`）。
- `flags`: 标志位（数值）。
- `amount`: 交易金额（数值）。
- `actualAmount`: 实际扣款金额（数值）。
- `instrumentId`: 支付工具 ID。
- `processingRail`: 支付通道（样本：`UPI`）。
- `processingModeType`: 通道模式（样本：`UPI_DEFAULT`）。
- `reversalState` / `reversalResponseCode`: 冲正相关字段（可选）。

### to[]（收款方信息）
- `type`: 收款方式类型（样本：`VPA`）。
- `vpa` / `fullVpa`: 收款方 VPA。
- `name`: 收款方名称或账户名。
- `mcc`: 商户类别码（可为 `0000`）。
- `firstPartyMerchant`: 是否第一方商户。
- `amount`: 收款金额。
- `state`: 收款侧状态（样本：`FAILED` 或成功状态）。
- `amountInfo`:
  - `value`: 金额数值。
  - `currencyCode`: 币种（样本：`INR`）。

## 观察与推断
- `response.size=15` 与 `changes.length=15` 一致，说明一次查询默认返回 `size` 条。
- `nextPage` 是不透明翻页 token，后续分页需要携带。
- `paymentState` 主要出现 `COMPLETED` / `FAILED`。
- `amount` 字段数值呈现为 `20000/11000/10100` 这类格式，**推测**是以分/paise 计价（例如 `20000` ≈ `200.00 INR`），需结合其他接口或 UI 进一步确认。

## 脱敏说明
- 本文档不包含请求头、令牌或真实账号明文。
- 交易记录页面使用 **脱敏后的静态样本数据**，仅用于展示渲染效果。
