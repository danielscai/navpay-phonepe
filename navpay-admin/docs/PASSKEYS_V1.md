# NavPay Passkey(WebAuthn) 设计与使用说明 (V1)

## 目标
- 在保留 Google Authenticator(TOTP) 的同时，新增 Passkey 登录方式。
- 兼容 mac 与非 mac 设备:
- mac: Safari/Chrome + Touch ID/iCloud Keychain（或外接安全密钥）
- 非 mac: Chrome/Edge/Android/Windows + 平台验证器或外接安全密钥/手机
- 登录安全策略：
- Passkey 登录成功后不再要求输入密码/OTP
- 账号首次登录必须完成至少一种二次验证方式绑定：Passkey 或 TOTP

## 功能范围
- 个人设置 `/admin/account`
- 绑定 Passkey（可选填设备名称）
- 查看 Passkey 列表（创建时间、最近使用）
- 删除 Passkey（软删除，`revokedAtMs`）
- 登录页 `/auth/login`
- 支持点击「使用 Passkey 登录」
- MFA 绑定页 `/auth/2fa/enroll`
- 新增「绑定 Passkey（推荐）」入口，满足首次登录必须绑定的要求

## 数据模型
表：`webauthn_credentials`
- `user_id`: 归属用户
- `credential_id`: base64url（唯一）
- `public_key`: base64url
- `counter`: 签名计数器（防重放）
- `transports_json`: 浏览器提供的 transports（可选）
- `device_name`: 用户自定义名称（可选）
- `last_used_at_ms`: 最近使用
- `revoked_at_ms`: 删除时间（软删除）

## 接口
- `POST /api/webauthn/registration/options`
  - 需要登录与 CSRF
  - 返回 `options`，并通过 httpOnly cookie 保存 challenge（5 分钟有效）
- `POST /api/webauthn/registration/verify`
  - 需要登录与 CSRF
  - 校验注册响应，落库 `webauthn_credentials`
  - 成功后会将 `totpMustEnroll=false`（表示已满足“至少绑定一种二次验证”）
- `POST /api/webauthn/authentication/options`
  - 需要 CSRF（无需登录）
  - 根据 username 返回 `options`，并通过 httpOnly cookie 保存 challenge（5 分钟有效）
- 登录验证：
  - 通过 NextAuth Credentials 的 `webauthn` 字段完成断言校验

## 配置
环境变量（可选）：
- `WEBAUTHN_RP_ID`
  - 默认从 `APP_BASE_URL` 推导 hostname
  - 生产建议显式设置为主域名，如 `admin.navpay.com`
- `WEBAUTHN_ORIGIN`
  - 默认等于 `APP_BASE_URL`
  - 必须与浏览器实际 origin 精确匹配（含 scheme/port）

## 兼容性与注意事项
- WebAuthn 需要 HTTPS（本地 localhost 例外）
- Passkey 依赖浏览器与系统能力，用户可能只支持外接安全密钥
- 若用户同时绑定了 Passkey 与 TOTP：
  - 可任选其一登录
  - TOTP 的“换绑”不会强制再次绑定（若仍存在 Passkey）

## 测试
自动化：
- `tests/e2e/passkey.spec.ts` 使用 Chromium CDP Virtual Authenticator 覆盖：
  - 绑定 Passkey
  - 使用 Passkey 登录

手动验证（开发环境）：
- 更新代码后先执行一次数据库迁移：
```bash
cd navpay-admin
yarn db:migrate
```
- 然后登录任意账号，进入 `/admin/account` 绑定 Passkey。
