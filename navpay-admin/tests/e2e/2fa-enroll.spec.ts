import { test, expect } from "@playwright/test";
import { parseSecretFromOtpAuth, totpToken } from "./totp";

test("2FA enroll flow: first login forces enroll, then OTP login works", async ({ page }) => {
  await page.goto("/auth/login");

  await page.getByRole("button", { name: "密码登录" }).click();
  await page.locator("#username2").fill("qa_enroll");
  await page.locator("#password").fill("NavPayEnroll@123456!");
  await page.getByRole("button", { name: "下一步" }).click();

  // First login: password-only session is allowed, then force enrollment.
  await expect(page).toHaveURL(/\/auth\/2fa\/enroll/);

  // Read otpauth from page (manual key block).
  const otpauth = await page.locator("text=otpauth://totp").first().innerText();
  const secret = parseSecretFromOtpAuth(otpauth.trim());

  // Be resilient to 30s step boundary: try -30s/current/+30s window.
  const now = Date.now();
  const candidates = [
    await totpToken(secret, now - 60_000),
    await totpToken(secret, now - 30_000),
    await totpToken(secret, now),
    await totpToken(secret, now + 30_000),
    await totpToken(secret, now + 60_000),
  ];
  const codesTitle = page.getByText("备用恢复码（请妥善保存）");
  let ok = false;
  for (const t of candidates) {
    await page.locator("#enroll-token").fill(t);
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/2fa/enroll/confirm") && r.request().method() === "POST"),
      page.getByRole("button", { name: "确认绑定" }).click(),
    ]);
    const j = await resp.json().catch(() => null);
    try {
      await expect(codesTitle).toBeVisible({ timeout: 2_000 });
      ok = true;
      break;
    } catch {
      // try next candidate
    }
    // If server rejected, try next.
    if (!resp.ok() || !j?.ok) continue;
  }
  expect(ok, "2FA enroll confirm did not succeed").toBeTruthy();
  await expect(codesTitle).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page).toHaveURL(/\/admin/);

  // Logout then login again should require OTP
  await page.getByTestId("user-menu").click();
  await page.getByTestId("user-logout").click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/auth/login");
  await page.getByRole("button", { name: "密码登录" }).click();
  await page.locator("#username2").fill("qa_enroll");
  await page.locator("#password").fill("NavPayEnroll@123456!");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("Google Authenticator 验证码 / 备用恢复码")).toBeVisible();
  await page.getByLabel("Google Authenticator 验证码 / 备用恢复码").fill(await totpToken(secret));
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page).toHaveURL(/\/admin(\/|$)/, { timeout: 30_000 });
});
