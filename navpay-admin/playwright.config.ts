import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "rm -rf .next data/test.db && ENABLE_DEBUG_TOOLS=1 NEXTAUTH_URL='http://localhost:3100' APP_BASE_URL='http://localhost:3100' DATABASE_URL='file:./data/test.db' yarn db:migrate && ENABLE_DEBUG_TOOLS=1 NEXTAUTH_URL='http://localhost:3100' APP_BASE_URL='http://localhost:3100' DATABASE_URL='file:./data/test.db' yarn db:seed && ENABLE_DEBUG_TOOLS=1 NEXTAUTH_URL='http://localhost:3100' APP_BASE_URL='http://localhost:3100' DATABASE_URL='file:./data/test.db' yarn build && ENABLE_DEBUG_TOOLS=1 NEXTAUTH_URL='http://localhost:3100' APP_BASE_URL='http://localhost:3100' DATABASE_URL='file:./data/test.db' yarn start -p 3100",
    cwd: __dirname,
    url: "http://localhost:3100",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
