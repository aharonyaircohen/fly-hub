import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL,
    // Playwright traces persist raw request headers. Live journeys use real
    // repository credentials, so retain visual and sanitized text artifacts
    // without writing reusable secrets into a trace archive.
    trace: "off",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "live-chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--host-rules=MAP localhost 127.0.0.1",
            "--disable-extensions",
          ],
        },
      },
    },
  ],
});
