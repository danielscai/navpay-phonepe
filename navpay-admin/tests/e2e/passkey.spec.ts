import { test, expect } from "@playwright/test";
import { totpToken } from "./totp";

test("Passkey: enroll then login with passkey", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "Virtual WebAuthn authenticator requires Chromium CDP");

  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // Login with deterministic QA TOTP.
  await page.goto("/auth/login");
  await page.getByLabel("用户名").fill("qa");
  await page.getByLabel("密码").fill("NavPayQA@123456!");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("Google Authenticator 验证码 / 备用恢复码")).toBeVisible();
  await page
    .getByLabel("Google Authenticator 验证码 / 备用恢复码")
    .fill(await totpToken("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page).toHaveURL(/\/admin/);

  // Enroll passkey from account settings.
  await page.goto("/admin/account");
  await page.getByPlaceholder("例如：MacBook Touch ID / YubiKey").fill("Playwright Virtual Passkey");
  await page.getByRole("button", { name: "添加 Passkey" }).click();
  await expect(page.getByText("Playwright Virtual Passkey")).toBeVisible();

  // Logout and login with passkey.
  await page.getByTestId("user-menu").click();
  await page.getByTestId("user-logout").click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/auth/login");
  await page.getByLabel("用户名").fill("qa");
  await page.getByRole("button", { name: "使用 Passkey 登录" }).click();
  await expect(page).toHaveURL(/\/admin/);
});

