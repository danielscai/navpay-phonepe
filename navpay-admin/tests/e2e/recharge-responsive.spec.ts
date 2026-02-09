import { test, expect } from "@playwright/test";
import { totpToken } from "./totp";

async function loginQa(page: any) {
  await page.goto("/auth/login");
  // Login page defaults to Passkey tab; switch to password flow for e2e.
  await page.getByRole("button", { name: "密码登录" }).click();
  await page.locator("#username2").fill("qa");
  await page.locator("#password").fill("NavPayQA@123456!");
  await page.getByRole("button", { name: "下一步" }).click();
  await expect(page.getByLabel("Google Authenticator 验证码 / 备用恢复码")).toBeVisible();
  await page.getByLabel("Google Authenticator 验证码 / 备用恢复码").fill(await totpToken("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));
  await page.getByRole("button", { name: "验证并登录" }).click();
  await expect(page).toHaveURL(/\/(admin|merchant)(\/|$)/, { timeout: 30_000 });
}

async function assertNoHorizontalOverflow(page: any, label: string) {
  const res = await page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const sw = Math.max(root.scrollWidth, body.scrollWidth);
    const cw = Math.max(root.clientWidth, body.clientWidth);
    const overflow = sw - cw;
    const vw = root.clientWidth;

    function isVisible(el: Element) {
      const s = window.getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden";
    }

    // Find the top offenders that push content beyond the viewport.
    const offenders: any[] = [];
    const all = Array.from(document.querySelectorAll("*"));
    for (const el of all) {
      if (!(el instanceof HTMLElement)) continue;
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2) continue;
      const rightOverflow = Math.max(0, r.right - vw);
      const leftOverflow = Math.max(0, -r.left);
      const ow = el.scrollWidth - el.clientWidth;
      if (rightOverflow > 1 || leftOverflow > 1 || ow > 2) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          className: el.className,
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          rightOverflow,
          leftOverflow,
          text: (el.innerText || "").slice(0, 120),
        });
      }
    }
    offenders.sort((a, b) => (b.rightOverflow + b.leftOverflow + (b.scrollWidth - b.clientWidth)) - (a.rightOverflow + a.leftOverflow + (a.scrollWidth - a.clientWidth)));
    return { sw, cw, overflow, offenders: offenders.slice(0, 5) };
  });

  expect(res.overflow, `${label} overflows by ${res.overflow}px (sw=${res.sw}, cw=${res.cw}). Offenders: ${JSON.stringify(res.offenders, null, 2)}`).toBeLessThanOrEqual(1);
}

test("Recharge simulator pages are responsive (no horizontal overflow)", async ({ page }) => {
  await loginQa(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/tools/recharge-simulator");
  await expect(page.getByRole("button", { name: "创建充值订单" })).toBeVisible();
  await assertNoHorizontalOverflow(page, "recharge-simulator list (mobile)");

  // Create intent, open sim page
  await page.getByRole("button", { name: "创建充值订单" }).click();
  await page.waitForTimeout(300); // let list refresh
  const openHref = await page.locator("a[href^='/admin/tools/recharge-simulator/']").first().getAttribute("href");
  expect(openHref).toContain("/admin/tools/recharge-simulator/");
  await page.goto(openHref!);
  await expect(page.getByText("充值页面（调试用）")).toBeVisible();
  await assertNoHorizontalOverflow(page, "recharge intent sim (mobile)");

  // Desktop check too
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto("/admin/tools/recharge-simulator");
  await expect(page.getByText("最近订单")).toBeVisible();
  await assertNoHorizontalOverflow(page, "recharge-simulator list (desktop)");
});
