import { test, expect } from "@playwright/test";
import { parseSecretFromOtpAuth, totpToken } from "./totp";

test("2FA enroll flow: first login forces enroll, then OTP login works", async ({ page }) => {
  await page.goto("/auth/login");

  await page.getByLabel("用户名").fill("qa_enroll");
  await page.getByLabel("密码").fill("NavPayEnroll@123456!");
  await page.getByRole("button", { name: "下一步" }).click();

  // First login: password-only session is allowed, then force enrollment.
  await expect(page).toHaveURL(/\/auth\/2fa\/enroll/);

  // Read otpauth from page (manual key block).
  const otpauth = await page.locator("text=otpauth://totp").first().innerText();
  const secret = parseSecretFromOtpAuth(otpauth.trim());
  const token = await totpToken(secret);

  await page.getByLabel("验证码").fill(token);
  await page.getByRole("button", { name: "确认绑定" }).click();
  await expect(page.getByText("备用恢复码（请妥善保存）")).toBeVisible();

  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(/\/admin/);

  // Logout then login again should require OTP
  await page.getByTestId("user-menu").click();
  await page.getByTestId("user-logout").click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/auth/login");
  await page.getByLabel("用户名").fill("qa_enroll");
  await page.getByLabel("密码").fill("NavPayEnroll@123456!");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("Google Authenticator 验证码 / 备用恢复码")).toBeVisible();
  await page.getByLabel("Google Authenticator 验证码 / 备用恢复码").fill(await totpToken(secret));
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page).toHaveURL(/\/admin/);
});

