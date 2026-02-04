# Pine 注入与 pehelp 测试流程记录

## 背景
- Pine 注入模块位于：`src/signature_bypass`
- 需要通过一系列构建/预缓存步骤，才能在 pehelp 模拟器上测试
- 目前只有一个已登录的 PhonePe 账号，且运行在 pehelp 对应的模拟器中

## 固定流程（顺序不可变）
1. 注入签名绕过
   - 命令：`yarn sigbypass inject`
2. 构建 https 模块预缓存
   - 命令：`yarn https pre-cache -d`
3. 构建 pehelp 模块预缓存
   - 命令：`yarn pehelp pre-cache -d`
4. 启动 pehelp 测试
   - 命令：`yarn pehelp`

## 说明
- 以上流程整体耗时较长，但目前是唯一可用路径。
- 若模拟器/账号状态变化，需要重新确认注入与预缓存步骤。
