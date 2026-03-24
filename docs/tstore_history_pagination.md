# tstore/v2/units/changes 全量历史抓取流程

## 目标
通过 `fromTimestamp` 逐步推进的方式分页拉取历史交易变更记录，并写入 `log_server` 的交易展示页 JSON 数据源。

## 核心结论
- `tstore/v2/units/changes` 的分页可通过 `fromTimestamp` 递增实现。
- 每次请求返回 `changes` 数组，取最后一条记录的 `createdAt`，下次请求使用 `fromTimestamp = createdAt + 1`。
- 请求频率控制为 **0.5s/次**，避免触发风控或限流。
- 如果出现 `HTTP 412`，说明请求头/校验参数已过期，需要先让 App 发出一次新请求以刷新参数，然后再重试。

## 使用脚本
脚本位置：`tools/fetch_tstore_history.py`

功能：
- 从 `src/services/log_server/data/logs.db` 中读取最新的 tstore 请求头与 URL 参数。
- 以 `fromTimestamp=0` 开始分页请求，逐页推进。
- 合并所有 `changes` 去重后写入：
  - `/tmp/tstore_changes_all.json`
  - `src/services/log_server/public/transactions.html`（用于展示）

执行方式：
```bash
python3 tools/fetch_tstore_history.py
```

## 分页逻辑（伪代码）
```text
fromTimestamp = 0
repeat:
  resp = POST /apis/tstore/v2/units/changes?fromTimestamp=fromTimestamp&size=15&sortOrder=ASC
  if changes 为空: 退出
  maxCreatedAt = max(changes.createdAt)
  fromTimestamp = maxCreatedAt + 1
  sleep(0.5s)
until changes 数量 < size
```

## 展示页说明
交易记录页面使用 `transactions.html` 中的 `rawResponse` 作为静态数据源。脚本会自动替换该 JSON 片段。

## 展示页字段映射规则
前端会根据 `view.type` 与 `data` 内字段判断交易类型与角色，并填充表格：

类型判断（优先级顺序）：
1. `view.type == RECEIVED_PAYMENT` 或 `data.receivedIn` 存在 => **收款**
2. `data.paidFrom` 存在 => **付款**
3. `data.to.mcc != '0000'` => **支付**

字段映射（摘要）：
- 付款方：优先 `data.from.cbsName / data.from.name / data.from.phone`
- 收款方：优先 `data.receivedIn.accountHolderName / data.to.name`
- 付款方/收款方账户号：优先 `data.from.phone / data.from.userId` 或 `receivedIn.accountNumber`
- 收款 VPA：优先 `receivedIn.vpa`
- 付款 VPA：优先 `paidFrom.vpa`
- 金额：优先 `data.amount`，否则 `paidFrom.amount`/`receivedIn.amount`
- 状态：`data.paymentState`，若不存在则取 `view.state`

## 故障排查
- **页面空白**：检查 `transactions.html` 中 `rawResponse` 是否被正确替换；脚本使用安全替换避免 JSON 字符串被破坏。
- **HTTP 412**：请求头过期或校验参数不匹配，需刷新 App 端请求并重新运行脚本。

## 参数过期的应对方案（可执行）
当 `X-REQUEST-CHECKSUM-V4` 过期时，需要 App 端产生新的请求参数。可采用“页面保活/定时刷新”的方式：

做法：
1. App 保持在交易记录页面。
2. 定时触发一次“刷新历史”动作（例如每 30-60 秒）。
3. log_server 会持续记录最新请求头与参数。
4. 运行 `tools/fetch_tstore_history.py` 即可抓取全量历史。

说明：
- 该方案无需逆向 checksum 算法，工程成本最低。
- 如果 App 页面退出或长时间不刷新，参数会失效，需要重新进入页面触发一次请求。
