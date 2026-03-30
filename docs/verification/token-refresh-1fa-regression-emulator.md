# Token Refresh 1FA 回归验证（模拟器）

日期：2026-03-30

目的：验证 `tokenrefresh` 已切换到 `org/1fa` 刷新链路，并确保 trusted_records 同步不再因 `401 PR004` 失败。

设备与环境：
- Android Emulator：`emulator-5554`
- PhonePe 包名：`com.phonepe.app`
- NavPay 包名：`com.navpay`
- Admin 本地服务：`http://localhost:3000`
- 目标设备：`dev_d88fb7ad-63e9-48fe-bc7f-56e525776876`

## 通过标准

- Content Provider 刷新返回 `providers=1`（表示走 1FA/org 刷新链路）。
- trusted_records 同步（后端 `syncDeviceHistoryTransactions`）返回 `httpStatus=200`。

---

## 场景一：PhonePe 后台，手工触发 tokenrefresh，再同步 trusted_records

1. 让 PhonePe 进入后台（切到 Launcher）：

```bash
adb -s emulator-5554 shell am start -n com.phonepe.app/.launch.core.main.ui.MainActivity
adb -s emulator-5554 shell input keyevent 3
```

2. 触发 Content Provider token refresh：

```bash
adb -s emulator-5554 shell content call \
  --uri content://com.phonepe.navpay.provider/user_data \
  --method tokenrefresh
```

期望输出包含：
- `ok=true`
- `message=token refresh triggered providers=1`

3. 触发 trusted_records 同步（等价后端调用）：

```bash
cd navpay-admin
node --env-file=.env.local --import tsx -e "
import m from './src/lib/device-history-sync.ts';
const fn=(m).syncDeviceHistoryTransactions;
const deviceId='dev_d88fb7ad-63e9-48fe-bc7f-56e525776876';
try {
  const r=await fn(deviceId);
  console.log(JSON.stringify({ok:true,httpStatus:200,...r},null,2));
} catch(e) {
  console.log(JSON.stringify({ok:false,httpStatus:500,error:e instanceof Error?e.message:String(e)},null,2));
  process.exit(1);
}
"
```

期望输出：
- `ok=true`
- `httpStatus=200`

---

## 场景二：navpay-android 前台、PhonePe 后台，由 navpay 触发 refresh，再同步

说明：`NavPayApp` 启动时会由 `PhonePeTokenRefreshManager` 立即触发一次 `tokenrefresh(reason=startup)`。

1. 准备前后台状态：

```bash
adb -s emulator-5554 shell am start -n com.phonepe.app/.launch.core.main.ui.MainActivity
adb -s emulator-5554 shell input keyevent 3
adb -s emulator-5554 shell am force-stop com.navpay
adb -s emulator-5554 shell am start -n com.navpay/.MainActivity
```

2. 抓日志确认 navpay 触发了 tokenrefresh：

```bash
adb -s emulator-5554 logcat -d | rg -n "PhonePeTokenRefresh|tokenrefresh ok"
```

期望日志包含：
- `PhonePeTokenRefresh: tokenrefresh ok reason=startup`
- `message=token refresh triggered providers=1`

3. 再执行 trusted_records 同步（同场景一第 3 步命令）。

期望输出：
- `ok=true`
- `httpStatus=200`

---

## 常见失败信号

- `tokenrefresh ... providers=2`：仍在旧路径（sso/account）或安装包未更新。
- 同步返回 `401` 且 `PR004 Unauthorized`：token 与请求链路不匹配，通常是 1FA 未刷新成功。
