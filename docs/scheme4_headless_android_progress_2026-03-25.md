# 方案4进展报告（Headless Android）

日期：2026-03-25
目标 APK：`cache/profiles/full/build/patched_signed.apk`
目标：评估“无界面 Android 环境”替代模拟器的可行性，并定位 redroid 失败原因。

## 测试范围

1. 本机 Android Emulator（现成设备）
2. 本机 Android Emulator（`-no-window`）
3. 本机 Docker redroid（多镜像/多参数）
4. OrbStack Ubuntu VM 内 Docker redroid（含环境修复后重试）
5. OrbStack Ubuntu VM 内直接运行虚拟机（不经过 Docker）

## 过程与结果

### A. 本机 Emulator（基线路径）

执行要点：
- `adb devices -l`
- `adb -s emulator-5554 install -r -g .../patched_signed.apk`
- `adb -s emulator-5554 shell am start -W -n com.phonepe.app/.launch.core.main.ui.MainActivity`
- `adb -s emulator-5554 shell pidof com.phonepe.app`
- `adb -s emulator-5554 shell dumpsys activity services com.phonepe.app`

结果：
- 成功（设备在线、安装成功、主入口启动成功、进程与服务链可见）。

证据：
- [cache/headless_android_probe/evidence.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/cache/headless_android_probe/evidence.md)

### B. 本机 Emulator（`-no-window`）

执行要点：
- `emulator -avd phonepe1 -no-window -no-audio -gpu swiftshader_indirect -read-only -port 5558`
- 随后执行 install/start 验证

结果：
- 可运行到 install / `am start`，功能可达。
- 风险：多 emulator 并存时出现 ADB 争用（`more than one emulator`）。

证据：
- [cache/headless_android_probe/evidence.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/cache/headless_android_probe/evidence.md)

### C. 本机 Docker redroid

已测：
- `redroid/redroid:16.0.0_64only-latest`
- `15/14/13/12` 同系列 tag
- 参数变体：`androidboot.use_memfd=true`、`androidboot.redroid_gpu_mode=guest`

结果：
- 全部失败，容器几乎立即退出（`exit=129`）。
- `adb connect` 失败或仅 offline。

证据：
- [cache/headless_android_probe/evidence.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/cache/headless_android_probe/evidence.md)

### D. OrbStack Ubuntu VM 内 redroid（重点复测）

执行要点：
- 使用 `orb -m ubuntu ...` 进入 VM 执行。
- 已验证可通过 `sudo su -` 切换到 VM 内 `root`；问题不在“没有拿到 root”。
- 修复 VM 环境：
  - 原始 APT 源 404（oracular 镜像失效）
  - 切换到 `old-releases.ubuntu.com`
  - 安装并启动 `docker.io`、`android-tools-adb`、`containerd`
- redroid 重试：
  - `16.0.0_64only-latest + androidboot.use_memfd=true`
  - `16.0.0_64only-latest + androidboot.redroid_gpu_mode=guest`
- 额外深挖：
  - 在 VM 内直接检查 `/dev/binder*` 权限与可访问性
  - 临时放宽 `/dev/binder`、`/dev/hwbinder`、`/dev/vndbinder` 到 `666`
  - 将 `/data` 挂载从 macOS 共享工作区路径改为 VM 本地目录 `/var/tmp/redroid-*-data`
  - 分别复测 `androidboot.use_memfd=true` 与 `androidboot.redroid_gpu_mode=guest`

结果：
- 原始状态下，两次都未拿到可用 ADB 设备。
- 原始状态下，容器先 `running` 后 `exit=129`，`docker logs` 基本为空，`adb` 显示 offline 或连接拒绝。
- 深挖后确认：失败不是单点原因，而是 3 层连续阻塞：
  1. `binder` 设备节点在 VM 中存在，但默认权限导致 redroid 容器内打开 `/dev/binder` 返回 `EACCES`
  2. 将 `/data` 挂到 macOS 共享工作区路径时，Android 创建 `/data/user/0` 失败，报 `Permission denied`
  3. 即使临时绕过前两项，Android 16 redroid 在当前 OrbStack VM 内仍会因 `ashmem` / 图形缓冲链路失败，`surfaceflinger` 崩溃，`zygote` 持续 `restarting`，ADB 仍停留在 `offline`

证据：
- [cache/headless_android_probe/evidence_vm_redroid.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/cache/headless_android_probe/evidence_vm_redroid.md)

### E. OrbStack Ubuntu VM 内直接运行虚拟机（不经过 Docker）

执行要点：
- 在 `orb -m ubuntu` 内直接检查虚拟化能力，而不是通过 Docker。
- 安装：
  - `qemu-system-arm`
  - `qemu-utils`
- 直接做最小化 QEMU 验证：
  - `qemu-system-aarch64 -accel help`
  - `qemu-system-aarch64 -machine virt,accel=kvm -cpu host ...`
  - `qemu-system-aarch64 -machine virt,accel=tcg ...`

结果：
- QEMU 二进制本身可安装、可运行。
- `qemu-system-aarch64 -accel help` 显示二进制支持 `kvm` 和 `tcg`。
- 但宿主 VM 内没有 `/dev/kvm`。
- 强制使用 KVM 时，直接失败：
  - `Could not access KVM kernel module: No such file or directory`
  - `failed to initialize kvm: No such file or directory`
- 退回 `tcg`（纯软件模拟）时，QEMU 进程本身可以启动并保持运行，说明问题不是 QEMU 包损坏，而是没有硬件虚拟化加速。

结论：
- “不使用 Docker，直接在 OrbStack VM 内再跑一层 Android 虚拟机”不能从根本上解决问题。
- 它确实绕开了 redroid 的容器层问题，但会立刻撞上新的硬阻塞：OrbStack VM 内没有 `/dev/kvm`，无法提供嵌套虚拟化。
- 理论上仍可尝试纯软件模拟（TCG），但这不属于当前项目的可用主路径，性能与稳定性都不具备现实可行性。

## OrbStack VM 内进一步验证

### 1. `sudo su -` 已验证可用

- 在 `orb -m ubuntu` 中执行 `sudo su -` 后，`id` 返回 `uid=0(root)`。
- root 下可见：
  - `/dev/binder`
  - `/dev/hwbinder`
  - `/dev/vndbinder`
- 且 root 直接读取 `/dev/binder` 本身没有问题。
- 结论：OrbStack VM 内不是“拿不到 root”，也不是“VM 自己打不开 binder”。

### 2. 原始失败点：容器内 `binder` 权限被拒

- 在不改设备权限的情况下，`dmesg` 明确出现：
  - `Binder driver '/dev/binder' could not be opened. Error: 13 (Permission denied)`
- 这解释了为什么原始 redroid 容器会很快退出并表现为 `exit=129` / `adb offline`。
- 结论：第一阻塞点是“Docker 容器访问 OrbStack 提供的 binder 设备被拒绝”，不是“完全没有 binder”。

### 3. 已测 workaround：临时放宽 `/dev/binder*` 权限

- 测试动作：
  - `chmod 666 /dev/binder /dev/hwbinder /dev/vndbinder`
- 实测结果：
  - redroid 不再秒退
  - 容器可持续保持 `running`
  - `servicemanager`、`vold`、`adbd` 等进程可见
- 结论：
  - 这能证明前面的 `exit=129` 主要由 binder 访问权限引起
  - 但这只是临时绕过，不是完整修复

### 4. 已测失败项：共享工作区路径不能稳定作为 `/data`

- 当 `/data` 绑定到仓库路径这类 macOS 共享目录时，`dmesg` 出现：
  - `Failed to mkdir(/data/user/0): Permission denied`
  - `vold: Failed to prepare /data/user/0: Permission denied`
- 将 `/data` 改为 VM 本地目录，例如 `/var/tmp/redroid-native-data:/data` 后，这类错误消失。
- 结论：
  - redroid 的 `/data` 不应继续使用 OrbStack 的 macOS 共享工作区路径
  - 这是第二阻塞点，但可以通过改挂载位置规避

### 5. 已测失败项：`androidboot.use_memfd=true` 仍不足以启动完整系统

- 在“binder 权限已放宽 + `/data` 使用 VM 本地目录”的前提下，继续使用：
  - `androidboot.use_memfd=true`
- 实测结果：
  - 容器保持 `running`
  - 但 `sys.boot_completed` 始终为空
  - `adb devices` 仍显示 `offline`
  - `getprop init.svc.zygote` 显示 `restarting`
  - `logcat` / `dmesg` 出现：
    - `ashmem: Unable to open ashmem device: No such file or directory`
    - `MemoryHeapBase: error creating ashmem region`
    - `surfaceflinger` / `RenderEngine` 崩溃，`Abort message: 'output buffer not gpu writeable'`
- 结论：
  - `androidboot.use_memfd=true` 在当前 OrbStack VM 上不足以补齐 redroid 16 的运行前提
  - 第三阻塞点是 `ashmem` / gralloc / `surfaceflinger` 图形缓冲链路

### 6. 已测失败项：`androidboot.redroid_gpu_mode=guest` 仍不解决

- 在“binder 权限已放宽 + `/data` 使用 VM 本地目录”的前提下，继续追加：
  - `androidboot.redroid_gpu_mode=guest`
- 实测结果：
  - 容器仍然 `running`
  - `adb` 仍然 `offline`
  - `zygote` 仍然 `restarting`
  - `surfaceflinger` 仍因 `output buffer not gpu writeable` 崩溃
- 结论：
  - `guest` 渲染模式在当前 OrbStack VM 上没有把系统带到可用状态

## redroid失败根因（更新后）

1. 环境层面：
   - VM 内 `docker` / `adb` / `containerd` 已修复，且 `sudo su -` 可进入 root。
   - 因此失败不是“工具没装好”或“没有 root”。
2. 设备与权限层面：
   - OrbStack VM 提供了 `/dev/binder*`，但默认权限下 redroid 容器访问 `/dev/binder` 会被拒绝。
   - 这是导致原始 `exit=129` 的直接原因。
3. 文件系统层面：
   - OrbStack 的 macOS 共享目录不适合作为 Android `/data`，会触发 `/data/user/0` 权限错误。
4. Android 运行时层面：
   - 即使修正 binder 权限，并把 `/data` 改到 VM 本地目录，当前环境仍缺稳定的 `ashmem` / gralloc / 图形缓冲兼容能力。
   - 直接表现为 `surfaceflinger` 崩溃、`zygote` 重启、`sys.boot_completed` 不出现、ADB 始终 `offline`。
5. 虚拟化层面：
   - 若放弃 Docker，改为在 OrbStack VM 内直接再跑一层 Android 虚拟机，新的硬阻塞是没有 `/dev/kvm`。
   - 已通过 `qemu-system-aarch64 -machine virt,accel=kvm ...` 实测验证，KVM 初始化直接失败。
6. 结论：
   - OrbStack Ubuntu VM 内 redroid 不是“完全不能启动容器”，而是“可以部分绕过到容器 running，但无法修到 Android 可用态”。
   - OrbStack Ubuntu VM 内直接运行 Android 虚拟机也不是现实解法，因为缺少嵌套虚拟化。
   - 在当前证据下，这更像是 OrbStack guest kernel / 设备透传 / 图形与内存分配兼容层不满足 redroid 16 要求，而不是 APK 本身问题。

## 当前可行性结论

- 可作为主路径：本机 Emulator（建议使用单实例 + `-no-window`）。
- 当前不可行：redroid（本机 Docker 与 OrbStack Ubuntu VM 均未跑通到“ADB online + 安装 APK + 启动目标应用”）。
- 当前不可行：OrbStack Ubuntu VM 内直接再跑一层 Android 虚拟机（缺 `/dev/kvm`，只能退回纯软件模拟）。
- OrbStack VM 内 redroid 的可修复性判断：
  - 可部分修复：能把“容器秒退”修到“容器 running”
  - 当前未修复：无法把系统修到 `sys.boot_completed=1`
  - 当前结论：不建议继续把 OrbStack VM 作为 redroid 落地主路径

## 后续决策建议

1. 如果目标是“马上可用”：走本机 emulator `-no-window`，控制单实例，稳定性最高。
2. 如果目标是“容器化 headless”：迁移到可控 Linux host（可加载/确认 binder 相关能力）再做 redroid。
3. 如果目标是“直接在 Linux VM 里跑 Android 虚拟机而非 Docker redroid”：当前 OrbStack VM 也不适合作为主路径，因为没有 `/dev/kvm`，只能走纯软件模拟。
4. 若继续在 OrbStack VM 深挖：仅建议作为研究性排查，不建议再投入为生产路径；优先关注：
   - binder 设备权限如何稳定授予容器
   - 是否存在 ashmem / memfd 兼容层
   - `surfaceflinger` 的 gralloc / RenderEngine 崩溃是否可通过更换镜像版本或宿主能力解决

## 关联资料

- 方案4详细记录（研究目录）：
  - [src/research/headless_android_probe/README.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/src/research/headless_android_probe/README.md)
- 方案3真实性文档（供联动决策）：
  - [docs/checksum_service_scheme3_research.md](/Users/danielscai/Documents/workspace/navpay/navpay-phonepe/docs/checksum_service_scheme3_research.md)
