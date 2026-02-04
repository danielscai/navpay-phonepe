# log_server Checksum 调试集成

## 新增能力
1. 独立页面：`/checksum.html`
   - 用于手动生成 checksum
   - 依赖 phonepehelper 本地服务（127.0.0.1:19090）

2. 请求面板自动生成 checksum（tstore changes）
   - 当日志 URL 包含 `/apis/tstore/v2/units/changes`
   - 展示“使用本地 Checksum 服务”开关，默认开启
   - 发送请求时自动调用 `/api/checksum` 生成 `X-REQUEST-CHECKSUM-V4`

## 新增接口
- `POST /api/checksum`
  - 由 log_server 代理调用 `http://127.0.0.1:19090/checksum`

## 使用方式
1. 确保 phonepehelper 已启动并且服务健康：
   - `GET http://127.0.0.1:19090/health`
2. 打开日志首页，选择 tstore changes 请求
3. 保持开关开启，直接点击“发送”即可自动注入 checksum

## 相关文件
- `src/log_server/src/server.js`
- `src/log_server/public/index.html`
- `src/log_server/public/checksum.html`
