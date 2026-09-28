import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";

// Load .env so local runs pick up E2E_GITHUB_TOKEN / E2E_GITHUB_REPO /
// E2E_KODY_CREDENTIALS_REPO /
// RUN_REAL_E2E / BASE_URL etc. without requiring `source .env`. CI sets
// these via repo secrets and won't find a .env file — that's fine.
loadDotenv({ path: ".env", override: false });

const local = process.env.PW_LOCAL === "1";
const production = process.env.PW_PRODUCTION === "1";
const localBaseUrl = production
  ? "http://127.0.0.1:3344"
  : "http://127.0.0.1:3333";
// Some journeys read BASE_URL directly. Keep them and Playwright on the same
// target, even when .env contains a deployed URL.
if (local) process.env.BASE_URL = localBaseUrl;

/**
 * Playwright E2E test configuration.
 *
 * Usage:
 *   BASE_URL=https://my-app.vercel.app pnpm test:e2e
 *
 * In CI (GitHub Actions):
 *   Vercel deploys a preview → URL captured → passed as BASE_URL → tests run
 */
export default defineConfig({
  testDir: "./tests/e2e",

  /* Run tests in parallel — safe since each test uses a fresh context */
  fullyParallel: false, // Disabled: parallel workers can cause "Access denied" on localStorage in some Playwright versions
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  maxFailures: process.env.CI ? 1 : undefined,

  /* Reporter — GitHub Actions annotate failures inline */
  reporter: process.env.CI ? [["github"], ["html"]] : [["list"]],

  /* Local checks own their target. Production checks start a separate server
     and fail if its port is occupied. Deployed checks start no local server. */
  webServer: local
    ? {
        command: production
          ? "pnpm exec next start --hostname 127.0.0.1 --port 3344"
          : "pnpm dev",
        url: localBaseUrl,
        reuseExistingServer: !production,
        timeout: 120_000,
      }
    : undefined,

  use: {
    /* Target URL — set via BASE_URL env var */
    baseURL: local
      ? localBaseUrl
      : (process.env.BASE_URL ?? "http://127.0.0.1:3333"),

    /* Capture trace on first retry for debugging */
    trace: "on-first-retry",

    /* Screenshot on failure */
    screenshot: "only-on-failure",

    /* Video on failure */
    video: "retain-on-failure",
  },

  /* Browser variants */
  projects: [
    /* Chromium — primary browser for testing */
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        /* Disable HTTPS upgrade for localhost — needed for local dev against HTTP server */
        launchOptions: {
          args: [
            "--host-rules=MAP localhost 127.0.0.1",
            "--disable-extensions",
          ],
        },
        /* Use the bot token cookie for auth — enables real dashboard interactions */
        extraHTTPHeaders: {
          /* Pass bot token so API routes accept requests without OAuth session */
          ...(process.env.KODY_BOT_TOKEN
            ? { Authorization: `Bearer ${process.env.KODY_BOT_TOKEN}` }
            : {}),
        },
      },
    },

    /* Mobile Safari — verify responsive layout */
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 5"],
      },
    },
  ],

  /* Timeout conventions */
  timeout: 60_000,
});
