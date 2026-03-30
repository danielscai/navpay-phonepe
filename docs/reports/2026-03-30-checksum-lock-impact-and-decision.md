# Checksum 串行锁影响评估与阶段决策

Date: 2026-03-30
Scope: `src/services/checksum`

## 背景

在 `ChecksumHttpService` 中存在：

- `private synchronized ProbeResponse runProbe(...)`

该锁会把同一服务实例的请求串行化。与此同时当前服务仍采用：

- `server.setExecutor(Executors.newSingleThreadExecutor())`

## 评估结论

1. 在当前单线程 executor 配置下，这个 `synchronized` 不是主要性能瓶颈，额外开销很小（本就串行）。
2. 对未来扩容有明显约束：即便提升 HTTP worker 数，也会因为 `runProbe` 与 probe 内部同步而继续串行。
3. 从实测分段看，历史瓶颈主要来自“每请求重建 unidbg session”，不是 `new UnidbgChecksumProbe()` 构造本身。

## 已落实修复

- 将 `UnidbgChecksumProbe` 改为服务级复用实例，避免每请求重建 session。
- 增加分段耗时日志用于定位：`checksum_perf ...`

## 阶段决策（本轮）

- 先不继续拆解并发模型（不推进多 worker + 去共享状态改造）。
- 当前目标收敛为：稳定交付复用修复版本，并完成容器升级与压力验证。

## 后续候选优化（暂缓）

1. 线程安全重构：移除 probe 共享可变状态，支持真正并发执行。
2. 多实例/多进程池化：以进程级隔离替代单实例串行。
3. 精细化 GC/对象生命周期调优：降低长压测尾延迟。
