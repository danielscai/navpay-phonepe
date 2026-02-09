import { defineConfig } from "@playwright/test";

const E2E_ENV =
  "ENABLE_DEBUG_TOOLS=1 NEXTAUTH_URL='http://localhost:3100' APP_BASE_URL='http://localhost:3100' DATABASE_URL='file:./data/test.db' DEPOSIT_MNEMONIC_ENCRYPTION_KEY='change-me-32-bytes-min' DEPOSIT_MNEMONIC_ENC='v1:TfkRup/UP7VzoDL9:jUnE4SJlww/H6afuCiTLPg==:Yt8Pj5sBk2+ra6hipdv39rpoouzgRv/OBTSOPvVReS9yIiU6bvMIad0G+F51WdSssJeTmfmg+DSsTRE='";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Tests share a single SQLite DB and Next dev server; run serially to avoid flaky contention/timeouts.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    // Use `next dev` for e2e: much faster startup than `next build && next start`,
    // and sufficient for layout responsiveness assertions.
    command: `rm -rf .next data/test.db && ${E2E_ENV} yarn db:migrate && ${E2E_ENV} yarn db:seed && ${E2E_ENV} yarn dev -p 3100`,
    cwd: __dirname,
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
