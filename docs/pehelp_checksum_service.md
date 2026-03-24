# PhonePeHelper 本地 checksum 服务

## 目的
在 App 进程内通过 `EncryptionUtils.jnmcs(...)` 生成 `X-REQUEST-CHECKSUM-V4`，并通过本地 HTTP 服务暴露给外部工具调用。

## 实现位置
- `src/apk/phonepehelper/src/main/java/com/phonepehelper/ChecksumServer.java`
- `src/apk/phonepehelper/src/main/java/com/phonepehelper/ModuleInit.java`

`ModuleInit.init()` 中启动服务：
- `ChecksumServer.start(appContext)`

## 服务说明
- 监听地址：`127.0.0.1:19090`
- 健康检查：`GET /health`
- 生成 checksum：`POST /checksum`

请求体：
```json
{
  "path": "/apis/tstore/v2/units/changes",
  "body": "",
  "uuid": "<optional>"
}
```

返回：
```json
{
  "ok": true,
  "data": {
    "checksum": "<value>",
    "uuid": "<uuid>"
  }
}
```

## 关键点
- `path` 必须是 **encodedPath**（不包含 query）。
- `body` 为空字符串即可（该接口 body 为空）。
- `uuid` 不传则由服务端生成。

## 依赖说明
- 通过反射调用 `com.phonepe.networkclient.rest.EncryptionUtils.jnmcs`，避免编译期依赖。
- 需在 App 进程内执行（因此通过 Pine 注入的 PhonePeHelper 模块实现）。

## 构建与测试流程
参考：`docs/pehelp_pine_workflow.md`
