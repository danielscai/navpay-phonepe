# Tools Usage Conventions

This directory contains runnable helper scripts.

## Conventions (apply to new scripts going forward)
- Every runnable script should have a matching yarn alias in `package.json`.
- The yarn alias should run the script with **no parameters by default**.
- If parameters are needed, scripts should provide sensible defaults and allow overrides via flags/env vars.

## Defaults (common)
- adb device selection: if only one device/emulator is connected, auto-select it; if multiple, prefer `emulator-*` automatically, otherwise require `-s <serial>`.
  - 示例串号：`emulator-5554`（见 `tools/merge_split_apks.sh` 示例）。

## Step6: phonepehelper 集成测试
- Script: `tools/step6_verify_phonepehelper.sh`
- Yarn alias: `yarn 6`
- 默认 APK：`temp/phonepe_merged_test/com.phonepe.app_merged_signed.apk`
- 默认包名/主界面：`com.phonepe.app` / `.launch.core.main.ui.MainActivity`
- 验证日志 tag：`PPHelper`
- 依赖步骤：Step3（signature_bypass）+ Step4（https_interceptor）补丁叠加后，再注入 phonepehelper
- 可选参数：
  - `--apk <path>` 覆盖源 APK
  - `-s <serial>` 指定设备/模拟器
  - `--full` 全量重跑

## Patch: phonepehelper
- Script: `tools/patch_phonepehelper.sh`
- Yarn alias: `yarn patch:phonepehelper`
- 作用：编译并注入 `src/phonepehelper` 到已反编译目录

## Example
- `yarn login` -> `./tools/step5_auto_login.sh`
  - defaults to `$LOGIN_PHONE` or `6338933055`
  - optional: `--phone <number>` and `-s <serial>`
