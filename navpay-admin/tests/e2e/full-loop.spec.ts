import { test, expect } from "@playwright/test";
import { totpToken } from "./totp";

test("V1 Full Loop: 2FA -> webhook -> collect order -> callback worker", async ({ page }) => {
  await page.goto("/auth/login");

  // qa is seeded with deterministic 2FA for repeatable E2E.
  await page.getByLabel("用户名").fill("qa");
  await page.getByLabel("密码").fill("NavPayQA@123456!");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("Google Authenticator 验证码 / 备用恢复码")).toBeVisible();
  await page
    .getByLabel("Google Authenticator 验证码 / 备用恢复码")
    .fill(await totpToken("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page).toHaveURL(/\/admin/);

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

  // Create collect order with notifyUrl = receiveUrl
  await page.goto("/admin/tools/order-simulator");
  await page.getByRole("button", { name: "代收" }).click();
  await expect(page.locator("#sim-merchant")).toHaveValue(/.+/);
  const collectOrderNo = await page.locator("#sim-order-no").inputValue();
  await page.locator("#sim-notify-url").fill(receiveUrl);
  const [createResp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/admin/orders/collect") && r.request().method() === "POST"),
    page.getByRole("button", { name: "创建订单" }).click(),
  ]);
  const createStatus = createResp.status();
  const createText = await createResp.text().catch(() => "");
  expect(createResp.ok(), `collect create failed: ${createStatus} ${createText}`).toBeTruthy();
  await page.getByRole("button", { name: "刷新" }).click();

  // Wait for row and mark SUCCESS
  const row = page.locator("tr", { hasText: collectOrderNo });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "完成" }).click();
  await expect(page.getByText("SUCCESS")).toBeVisible();

  // Run callback worker
  await page.goto("/admin/tools/callback-worker");
  await page.getByRole("button", { name: "执行 Worker" }).click();
  await expect(page.getByText("SUCCESS")).toBeVisible();

  // Verify webhook received event
  await page.goto("/admin/tools/webhook-simulator");
  await page.getByRole("button", { name: "刷新事件" }).click();
  await expect(page.getByText("\"type\":\"collect\"")).toBeVisible();
});
