# NavPay 开发/测试账号（本地）

说明：
- `admin` 账号用于你日常使用，我不会在自动化测试或脚本中去重置它。
- 自动化测试使用专用账号 `qa` / `qa_enroll`。
- 下述 `qa` 的 2FA secret 为测试固定值，仅用于本地开发与测试，不要用于真实环境。

## admin（你使用）
- 用户名：`admin`
- 默认密码：`NavPay@123456!`
- 2FA：首次登录会要求绑定（`totpMustEnroll=true`）
- 如需恢复（清空 2FA+重置密码）：
```bash
cd navpay-admin
yarn db:resetadmin admin
```
- 如只清空 2FA：
```bash
cd navpay-admin
yarn db:reset2fa admin
```

## qa（自动化闭环测试使用，固定 2FA）
- 用户名：`qa`
- 密码：`NavPayQA@123456!`
- 2FA TOTP secret(base32)：`GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ`
- 备用恢复码（可用其一登录，使用后会被消费）：
- `NPQA2FA1`
- `NPQA2FA2`
- `NPQA2FA3`
- `NPQA2FA4`
- `NPQA2FA5`
- `NPQA2FA6`
- `NPQA2FA7`
- `NPQA2FA8`
- `NPQA2FA9`
- `NPQA2FAA`

## qa_enroll（自动化测试首次绑定 2FA）
- 用户名：`qa_enroll`
- 密码：`NavPayEnroll@123456!`
- 2FA：首次登录会要求绑定（`totpMustEnroll=true`），测试会自动从页面读取 otpauth 并完成绑定。
