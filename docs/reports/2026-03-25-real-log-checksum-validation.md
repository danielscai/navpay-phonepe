# 2026-03-25 Real Log Checksum Validation

## Summary

使用 `navpay-admin` 的真实拦截日志 `654` 验证了新的 `navpay-phonepe/src/services/checksum` 服务。

结论：

- `127.0.0.1:19190` 的 checksum 服务可处理真实 `phonepe` `POST` 请求
- 真实样本的头字段是 `X-REQUEST-CHECKMATE`
- `bash src/services/checksum/scripts/validate_real_fixture.sh` 默认是验证模式，不是录制模式
- 永久 JUnit 测试已覆盖真实 fixture 的稳定语义

## Evidence

执行过的命令：

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-admin
node --env-file=.env.local --import tsx scripts/export-intercept-checksum-fixture.ts 654
```

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
bash src/services/checksum/scripts/validate_real_fixture.sh
```

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/services/checksum
mvn test -Dtest=ChecksumFixtureLoaderTest,ChecksumHttpServiceRealFixtureTest
```

```bash
cd /Users/danielscai/Documents/workspace/navpay/navpay-phonepe
yarn checksum:test
```

## Notes

- 真实日志中没有 `X-REQUEST-CHECKSUM-V4`，而是 `X-REQUEST-CHECKMATE`
- 真实 fixture 文件：
  - `src/services/checksum/src/test/resources/fixtures/phonepe_intercept_replay.json`
- 稳定期望文件：
  - `src/services/checksum/src/test/resources/fixtures/phonepe_intercept_replay.expected.json`
- 这个验证证明的是结构级成功和稳定语义，不保证与真实 app 进程 checksum 字节值完全一致
