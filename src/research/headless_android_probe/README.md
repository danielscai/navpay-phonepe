# 无界面 Android 方案验证记录

目标：在这台 macOS arm64 机器上验证 `cache/profiles/full/build/patched_signed.apk` 是否能通过无界面 Android 环境运行，至少达到“可安装、可启动服务链”。

结论先行：
- 本地 Android Emulator 路径可用。现成的 `emulator-5554` 已验证到 `adb` 设备、安装、主入口启动、目标进程和服务链。
- 本地 `-no-window` Emulator 也能跑到 install / `am start`，但在当前环境里会受到多个 emulator 并存的 `adb` 争用影响，稳定性低于现成设备。
- redroid 在这台机器上仍不可落地。至少两组启动/镜像变体都失败了：一组在镜像拉取阶段被镜像源拒绝，另一组在容器启动后 1 秒内退出，且 `adb` 端口始终连接不上。
- 根因更像是宿主 Linux VM 能力不足，而不是 APK 本身：Docker VM 里没有 `/dev/binder*`、`/dev/ashmem*`、`/dev/kvm`，`/proc/filesystems` 也没有 binder/ashmem；而 redroid 官方文档明确要求 binder/ashmem 内核模块，`androidboot.use_memfd=true` 只能替代 ashmem，不替代 binder。

## OrbStack Ubuntu VM 复测（2026-03-25）

- 入口是 `orb -m ubuntu ...`，不是本地 macOS shell。
- 这台 OrbStack Ubuntu VM 初始没有 `docker` / `adb`，APT 源还指向了清华镜像的 `oracular`，`apt-get update` 直接 404。
- 修复动作是把 `/etc/apt/sources.list` 切到 `old-releases.ubuntu.com/ubuntu/`，再安装 `docker.io` 和 `android-tools-adb`，最后启动 `docker` / `containerd`。
- VM 里能看到 `/dev/binder`、`/dev/hwbinder`、`/dev/vndbinder`，但没有 `/dev/ashmem`、`/dev/kvm`，`/proc/filesystems` 里也没有 binder / ashmem。
- redroid 仍然起不成 ADB 可用设备：`16.0.0_64only-latest + androidboot.use_memfd=true` 和 `16.0.0_64only-latest + androidboot.redroid_gpu_mode=guest` 都只到 `running` 或很快 `exit=129`，`adb connect` 看到的都是 offline 设备，`patched_signed.apk` 没装进去。
- 详细命令和输出摘要见 [`cache/headless_android_probe/evidence_vm_redroid.md`](../../../cache/headless_android_probe/evidence_vm_redroid.md)。

## 环境

- macOS 26.3.1，arm64
- `adb`: `/Users/danielscai/Library/Android/sdk/platform-tools/adb`
- `emulator`: `/Users/danielscai/Library/Android/sdk/emulator/emulator`
- AVD: `phonepe1`, `phonepe_nologin`, `phonpe_loggedin1`
- APK: `cache/profiles/full/build/patched_signed.apk`
- 包名: `com.phonepe.app`
- 主入口: `com.phonepe.app/.launch.core.main.ui.MainActivity`

## 候选路径 A: 本地 Android Emulator（现成设备 `emulator-5554`）

### 启动 / 安装 / 验证命令

```bash
adb devices -l
adb -s emulator-5554 shell getprop sys.boot_completed
adb -s emulator-5554 install -r -g cache/profiles/full/build/patched_signed.apk
adb -s emulator-5554 shell am start -W -n com.phonepe.app/.launch.core.main.ui.MainActivity
adb -s emulator-5554 shell pidof com.phonepe.app
adb -s emulator-5554 shell dumpsys activity services com.phonepe.app
```

### 实测结果

- `adb` 设备：成功，看到 `emulator-5554`
- APK 安装：成功，`adb install` 返回 `Success`
- 主入口启动：成功，`am start -W` 返回 `Status: ok`
- 进程：成功，`pidof com.phonepe.app` 返回 PID
- 服务链：成功，`dumpsys activity services com.phonepe.app` 能看到 `com.google.firebase.sessions.SessionLifecycleService`

### 结论

这条路径可作为当前项目的稳定验证基线。

## 候选路径 B: 本地 `-no-window` Emulator（`phonepe1`，端口 `5558`）

### 启动 / 安装 / 验证命令

```bash
$HOME/Library/Android/sdk/emulator/emulator \
  -avd phonepe1 -no-window -no-audio -gpu swiftshader_indirect -read-only -port 5558
adb devices -l
adb -s emulator-5558 shell getprop sys.boot_completed
adb -s emulator-5558 install -r -g cache/profiles/full/build/patched_signed.apk
adb -s emulator-5558 shell am start -W -n com.phonepe.app/.launch.core.main.ui.MainActivity
```

### 实测结果

- `boot completed in 43206 ms`
- `adb devices -l` 在 boot 后能看到 `emulator-5558`
- APK 安装：成功，`Performing Incremental Install` 后返回 `Success`
- 主入口启动：成功，`am start -W` 返回 `Status: ok`，目标 Activity 为 `com.phonepe.app/.launch.core.main.ui.MainActivity`
- 代价：启动日志里不断出现 `adb: more than one emulator`，说明当前环境里多个 emulator 并存会干扰 emulator 自己的 ADB 维护动作，稳定性一般

### 结论

这条路径证明 `-no-window` 本身可行，但在当前环境中需要清理并发 emulator，才能把它稳定化成主路径。

## 候选路径 C: redroid，镜像变体 1（`11.0.0_64only-latest` + `androidboot.use_memfd=true`）

### 启动命令

```bash
docker run --rm --pull always --privileged \
  -v "$PWD/cache/headless_android_probe/redroid-data-11:/data" \
  -p 5557:5555 \
  redroid/redroid:11.0.0_64only-latest \
  androidboot.use_memfd=true
```

### 实测结果

- 镜像拉取失败
- Docker daemon 报 `403 Forbidden`
- 失败点发生在容器启动前，连 `docker run` 都没走到 `running`

### 结论

这组失败说明当前 Docker 镜像源对该 tag 的访问不通，和 APK 无关，也还没进入 redroid 运行时阶段。

## 候选路径 D: redroid，启动参数变体 2（`16.0.0_64only-latest` + `androidboot.redroid_gpu_mode=guest`）

### 启动 / 验证命令

```bash
docker run -d --name redroid-16-guest --pull always --privileged \
  -v "$PWD/cache/headless_android_probe/redroid-data-16:/data" \
  -p 5559:5555 \
  redroid/redroid:16.0.0_64only-latest \
  androidboot.redroid_gpu_mode=guest
adb connect 127.0.0.1:5559
adb devices -l | grep 5559
```

### 实测结果

- 镜像拉取：成功
- 容器状态：先进入 `running`，但很快退出
- `adb connect 127.0.0.1:5559`：失败，`Connection refused`
- `docker inspect`：`exit=129`
- `docker logs`：为空

### 结论

这组失败说明 redroid 镜像本体能拉下来，但在当前宿主能力下无法稳定进入可用 ADB 状态。

## 候选路径 E: redroid，修复尝试（`16.0.0_64only-latest` + `androidboot.use_memfd=true`）

### 启动 / 验证命令

```bash
docker run -d --name redroid-16-memfd --pull always --privileged \
  -v "$PWD/cache/headless_android_probe/redroid-data-16-memfd:/data" \
  -p 5560:5555 \
  redroid/redroid:16.0.0_64only-latest \
  androidboot.use_memfd=true
adb connect 127.0.0.1:5560
```

### 实测结果

- 镜像拉取：成功
- `adb connect 127.0.0.1:5560`：失败，`Connection refused`
- `docker inspect`：`exit=129`
- `docker logs`：为空

### 结论

这说明 `androidboot.use_memfd=true` 不是这台机器上的决定性修复项。它只能替代 ashmem，不会补齐 binder / 内核模块缺口。

## 宿主能力证据

### Docker 宿主

```text
Server=28.0.1 OS=linux Arch=aarch64 CgroupDriver=cgroupfs CgroupVersion=2 Security=name=seccomp,profile=unconfined,name=cgroupns
```

### Docker VM / 容器内检查

```text
uname: Linux 63397d48d5ce 6.10.14-linuxkit #1 SMP Mon Feb 24 16:35:16 UTC 2025 aarch64 Linux
dev entries:
filesystems:
cgroup mounts:
cgroup on /sys/fs/cgroup type cgroup2 (ro,nosuid,nodev,noexec,relatime)
```

### 解释

- `/dev/binder*`、`/dev/ashmem*`、`/dev/kvm` 都没有暴露出来
- `grep -E 'binder|ashmem' /proc/filesystems` 为空
- Docker 走的是 cgroup v2

这和 redroid 官方文档要求的 `binder_linux` / `ashmem_linux` 内核模块不一致。

## redroid 失败根因判断

基于命令输出，当前失败链路更像这样：

1. macOS Docker Desktop / OrbStack 提供的是 Linux VM，不是可随意加载内核模块的实体 Linux host。
2. 该 VM 没有 binder / ashmem / kvm 设备或文件系统能力。
3. redroid 官方文档要求安装 `binder_linux` 和 `ashmem_linux`，并把 `androidboot.use_memfd=true` 作为 ashmem 替代项。
4. 所以当前环境里，redroid 即便能拉到镜像，也会在 very-early boot 阶段失败，`adb` 无法形成稳定设备。

这是基于证据的推断，不是单点猜测。

## 可执行修复路径

如果要把 redroid 作为可持续的 headless 验证路径，建议直接迁移到 Linux host，前置条件如下：

### 1. 准备 Linux 主机

- Ubuntu / Debian / 其他可装内核模块的 Linux 发行版
- root 或 sudo 权限
- 可选：有 `/dev/kvm` 更好，但 redroid 核心问题仍是 binder / ashmem / memfd 相关能力

### 2. 预检宿主能力

```bash
uname -r
ls -l /dev/binder* /dev/ashmem* /dev/kvm
grep -E 'binder|ashmem' /proc/filesystems
docker info | grep -E 'CgroupDriver|CgroupVersion'
```

### 3. 安装 / 加载内核模块

```bash
sudo apt install linux-modules-extra-$(uname -r)
sudo modprobe binder_linux devices="binder,hwbinder,vndbinder"
sudo modprobe ashmem_linux || true
```

如果你用的是较新的 redroid 镜像，可以把 ashmem 迁移到 memfd：

```bash
androidboot.use_memfd=true
```

但 binder 仍然必须有。

### 4. 启动 redroid

```bash
docker run -itd --rm --privileged \
  --pull always \
  -v ~/redroid-data:/data \
  -p 5555:5555 \
  redroid/redroid:16.0.0_64only-latest \
  androidboot.use_memfd=true \
  androidboot.redroid_gpu_mode=guest
```

### 5. 连接 ADB

```bash
adb connect <linux-host-ip>:5555
adb devices -l
```

## 对比表

| 路径 | 结果 | adb 设备 | 安装 APK | 拉起进程/服务 | 主要证据 |
| --- | --- | --- | --- | --- | --- |
| 本地 emulator `emulator-5554` | 成功 | 成功 | 成功 | 成功 | `adb devices -l`、`pidof`、`dumpsys activity services` |
| 本地 `-no-window` emulator `phonepe1` | 成功到 install / start，稳定性一般 | 成功 | 成功 | 成功到 Activity 启动 | `Boot completed in 43206 ms`、install Success、`am start -W` |
| redroid `11.0.0_64only-latest` + `use_memfd` | 失败 | 无 | 无 | 无 | `403 Forbidden` |
| redroid `16.0.0_64only-latest` + `redroid_gpu_mode=guest` | 失败 | 无，`Connection refused` | 无 | 无 | `exit=129`，`docker logs` 空 |
| redroid `16.0.0_64only-latest` + `use_memfd=true` | 失败 | 无，`Connection refused` | 无 | 无 | `exit=129`，`docker logs` 空 |

## 复现步骤

1. 确认 APK 存在：
   ```bash
   ls -l cache/profiles/full/build/patched_signed.apk
   ```
2. 复现本地 emulator 基线：
   ```bash
   adb devices -l
   adb -s emulator-5554 install -r -g cache/profiles/full/build/patched_signed.apk
   adb -s emulator-5554 shell am start -W -n com.phonepe.app/.launch.core.main.ui.MainActivity
   adb -s emulator-5554 shell pidof com.phonepe.app
   adb -s emulator-5554 shell dumpsys activity services com.phonepe.app
   ```
3. 复现本地 `-no-window` 路径：
   ```bash
   $HOME/Library/Android/sdk/emulator/emulator \
     -avd phonepe1 -no-window -no-audio -gpu swiftshader_indirect -read-only -port 5558
   adb -s emulator-5558 install -r -g cache/profiles/full/build/patched_signed.apk
   adb -s emulator-5558 shell am start -W -n com.phonepe.app/.launch.core.main.ui.MainActivity
   ```
4. 复现 redroid 失败：
   ```bash
   docker run --rm --pull always --privileged \
     -v "$PWD/cache/headless_android_probe/redroid-data-11:/data" \
     -p 5557:5555 \
     redroid/redroid:11.0.0_64only-latest \
     androidboot.use_memfd=true

   docker run -d --name redroid-16-guest --pull always --privileged \
     -v "$PWD/cache/headless_android_probe/redroid-data-16:/data" \
     -p 5559:5555 \
     redroid/redroid:16.0.0_64only-latest \
     androidboot.redroid_gpu_mode=guest

   docker run -d --name redroid-16-memfd --pull always --privileged \
     -v "$PWD/cache/headless_android_probe/redroid-data-16-memfd:/data" \
     -p 5560:5555 \
     redroid/redroid:16.0.0_64only-latest \
     androidboot.use_memfd=true
   ```

## 参考

- redroid 官方文档：`remote-android/redroid-doc`，README 里列出了 `binder_linux` / `ashmem_linux` 的要求，以及 `androidboot.use_memfd=true` 的说明。
