import { test, expect } from "@playwright/test";
import { totpToken } from "./totp";

test("V1 Full Loop: 2FA -> webhook -> collect order -> callback worker", async ({ page }) => {
  await page.goto("/auth/login");

  // qa is seeded with deterministic 2FA for repeatable E2E.
  await page.getByRole("button", { name: "密码登录" }).click();
  await page.locator("#username2").fill("qa");
  await page.locator("#password").fill("NavPayQA@123456!");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("Google Authenticator 验证码 / 备用恢复码")).toBeVisible();
  await page
    .getByLabel("Google Authenticator 验证码 / 备用恢复码")
    .fill(await totpToken("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page).toHaveURL(/\/admin(\/|$)/, { timeout: 30_000 });

  // Create webhook receiver
  await page.goto("/admin/tools/webhook-simulator");
  await page.getByRole("button", { name: "创建" }).click();

  // Grab receive URL (monospace block)
  let receiveUrl = await page
    .locator("div.font-mono", { hasText: "/api/webhook/receive/" })
    .first()
    .innerText();
  receiveUrl = receiveUrl.trim();
  expect(receiveUrl).toContain("/api/webhook/receive/");
  if (receiveUrl.startsWith("/")) {
    receiveUrl = new URL(receiveUrl, page.url()).toString();
  }
  expect(receiveUrl).toMatch(/^https?:\/\//);

  // Create collect order with notifyUrl = receiveUrl (via simulator modal)
  await page.goto("/admin/tools/order-simulator");
  await page.getByRole("button", { name: "代收" }).click();
  await page.getByRole("button", { name: "新建订单" }).click();
  await expect(page.locator("#sim-merchant")).toBeVisible();
  await expect(page.locator("#sim-merchant")).toHaveValue(/.+/);
  const collectOrderNo = await page.locator("#sim-order-no").inputValue();
  await page.locator("#sim-notify-url").fill(receiveUrl);
  const [createResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/admin/orders/collect") && r.request().method() === "POST"),
    page.getByRole("button", { name: "创建订单" }).click(),
  ]);
  const createJson = await createResp.json().catch(() => null);
  expect(createResp.ok(), `collect create failed: ${createResp.status()} ${JSON.stringify(createJson)}`).toBeTruthy();
  const orderId = createJson?.id as string | undefined;
  expect(orderId, "missing collect order id").toBeTruthy();

  // Simulate user payment on pay page (this updates status and enqueues callback).
  await page.goto(`/pay/collect/${orderId}`);
  await expect(page.getByText(orderId)).toBeVisible();
  await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/pay/collect/${orderId}`) && r.request().method() === "POST"),
    page.getByRole("button", { name: "支付成功" }).click(),
  ]);

  // Run callback worker
  await page.goto("/admin/tools/callback-worker");
  await page.getByRole("button", { name: "执行 Worker" }).click();
  await expect(page.getByText("SUCCESS").first()).toBeVisible();

  // Verify webhook received event
  await page.goto("/admin/tools/webhook-simulator");
  await page.getByRole("button", { name: "刷新事件" }).click();
  await expect(page.getByText("\"type\":\"collect\"").first()).toBeVisible();
});
