import { test, expect } from "@playwright/test";
import { totpToken } from "./totp";

async function loginQa(page: any) {
  await page.goto("/auth/login");
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
}

async function createChannelAccount(page: any, opts: { name: string; inviterCode?: string; balance: string }) {
  await page.goto("/admin/payout/channels");
  await page.getByRole("button", { name: "新增支付账户" }).click();
  await expect(page.locator("#pp-create-name")).toBeVisible();
  await page.locator("#pp-create-name").fill(opts.name);
  if (opts.inviterCode) {
    await page.locator("#pp-create-inviter").fill(opts.inviterCode);
  }
  await page.locator("#pp-create-balance").fill(opts.balance);

  const [resp] = await Promise.all([
    page.waitForResponse((r: any) => r.url().includes("/api/admin/payment-persons") && r.request().method() === "POST"),
    page.getByRole("button", { name: "创建" }).click(),
  ]);
  const j = await resp.json().catch(() => null);
  expect(resp.ok(), `create channel account failed: ${resp.status()} ${JSON.stringify(j)}`).toBeTruthy();

  await expect(page.getByText("邀请码（给下线注册/绑定用）")).toBeVisible();
  const id = String(j?.id ?? "").trim();
  const inviteCode = String(j?.inviteCode ?? "").trim();
  const username = String(j?.username ?? "").trim();
  expect(inviteCode).toMatch(/^[A-Z0-9]{6}$/);
  expect(username).toMatch(/.+/);
  expect(id).toMatch(/^pp_/);
  await page.getByRole("button", { name: "我已记录" }).click();

  return { id, inviteCode, username };
}

test("TC-009: invite chain + today fee + multi-level rebates (India day)", async ({ page }) => {
  await loginQa(page);

  // Create chain A -> B -> C. Ensure C is picked for collect assignment (most recently updated with sufficient balance).
  const a = await createChannelAccount(page, { name: "渠道A", balance: "0.00" });
  const b = await createChannelAccount(page, { name: "渠道B", inviterCode: a.inviteCode, balance: "0.00" });
  const c = await createChannelAccount(page, { name: "渠道C", inviterCode: b.inviteCode, balance: "1000.00" });

  // Create webhook receiver for collect callback.
  await page.goto("/admin/tools/webhook-simulator");
  await page.getByRole("button", { name: "创建" }).click();
  let receiveUrl = await page.locator("div.font-mono", { hasText: "/api/webhook/receive/" }).first().innerText();
  receiveUrl = receiveUrl.trim();
  if (receiveUrl.startsWith("/")) receiveUrl = new URL(receiveUrl, page.url()).toString();

  // Create collect order with a stable amount.
  await page.goto("/admin/tools/order-simulator");
  await page.getByRole("button", { name: "代收" }).click();
  await page.getByRole("button", { name: "新建订单" }).click();
  await expect(page.locator("#sim-merchant")).toBeVisible();
  await expect(page.locator("#sim-merchant")).toHaveValue(/.+/);
  const orderNo = await page.locator("#sim-order-no").inputValue();
  expect(orderNo).toMatch(/^CO_/);
  await page.locator("#sim-notify-url").fill(receiveUrl);
  await page.locator("#sim-amount").fill("100.00");
  const [createResp] = await Promise.all([
    page.waitForResponse((r: any) => r.url().includes("/api/admin/orders/collect") && r.request().method() === "POST"),
    page.getByRole("button", { name: "创建订单" }).click(),
  ]);
  const createJson = await createResp.json().catch(() => null);
  expect(createResp.ok(), `collect create failed: ${createResp.status()} ${JSON.stringify(createJson)}`).toBeTruthy();
  const orderId = createJson?.id as string | undefined;
  expect(orderId).toBeTruthy();

  // Ensure assignment picked C (newest + sufficient balance).
  const od = await page.request.get(`/api/admin/orders/collect/${orderId}`);
  const odj = await od.json().catch(() => null);
  expect(od.ok(), `collect detail failed: ${od.status()} ${JSON.stringify(odj)}`).toBeTruthy();
  expect(String(odj?.order?.assignedPaymentPersonId ?? ""), "order not assigned to expected person").toBe(c.id);

  // Pay success (this triggers SUCCESS and commission settlement).
  await page.goto(`/pay/collect/${orderId}`);
  await expect(page.getByText(orderId as any)).toBeVisible();
  await Promise.all([
    page.waitForResponse((r: any) => r.url().includes(`/api/pay/collect/${orderId}`) && r.request().method() === "POST"),
    page.getByRole("button", { name: "支付成功" }).click(),
  ]);

  // Verify C today fee = 100 * 4.5% = 4.50
  await page.goto(`/admin/payout/payment-persons/${c.id}?tab=earnings`);
  await expect(page.getByText("收益统计（按 India 日）")).toBeVisible();
  const feeCard = page.getByText("今日总收益 (fee)").locator("..");
  await expect(feeCard.locator("div.font-mono").first()).toHaveText("4.50");

  // Verify B rebate L1 = 0.50, A rebate L2 = 0.30
  await page.goto(`/admin/payout/payment-persons/${b.id}?tab=earnings`);
  await expect(page.getByText("收益统计（按 India 日）")).toBeVisible();
  const rebateCardB = page.getByText("今日团队返利").locator("..");
  await expect(rebateCardB.locator("div.font-mono").first()).toHaveText("0.50");

  await page.goto(`/admin/payout/payment-persons/${a.id}?tab=earnings`);
  await expect(page.getByText("收益统计（按 India 日）")).toBeVisible();
  const rebateCardA = page.getByText("今日团队返利").locator("..");
  await expect(rebateCardA.locator("div.font-mono").first()).toHaveText("0.30");
});
