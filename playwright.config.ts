import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (decision D7). Run them on the Bun runtime with `bun run test:e2e`
 * (`bun --bun x playwright test`); each test launches its own Specquer on a temporary folder.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    // The installed Chrome, so nothing needs downloading
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    // The engine of a future desktop shell on macOS and Linux (`bunx playwright install webkit`)
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
