import { expect, test as base, type Page } from "@playwright/test";

import {
  isExpectedBrowserAbort,
  redactDiagnosticText,
  sanitizeDiagnosticUrl,
} from "../../scripts/live-ui-gate/core.mjs";
import {
  establishLiveKodyAccountSession,
  loadLiveKodyAccountCredentialsFromDashboard,
} from "./live-account-session";

const SECRET_ENVIRONMENT_NAMES = [
  "E2E_GITHUB_TOKEN",
  "KODY_SERVICE_KEY",
  "KODY_MASTER_KEY",
  "KODY_BOT_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "FLY_API_TOKEN",
  "BRAIN_CHAT_API_KEY",
  "E2E_KODY_EMAIL",
  "E2E_KODY_PASSWORD",
];

function configuredSecrets(): string[] {
  return SECRET_ENVIRONMENT_NAMES.map((name) => process.env[name] ?? "").filter(
    Boolean,
  );
}

function monitorPage(page: Page, diagnostics: string[]) {
  const secrets = configuredSecrets();
  const record = (message: string) => {
    if (diagnostics.length >= 200) return;
    diagnostics.push(redactDiagnosticText(message, secrets).slice(0, 2_000));
  };

  page.on("pageerror", (error) => record(`[pageerror] ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      if (
        /^Failed to load resource: the server responded with a status of \d+/.test(
          message.text(),
        )
      ) {
        return;
      }
      record(`[console:error] ${message.text()}`);
    }
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "unknown";
    if (isExpectedBrowserAbort(errorText)) return;
    record(
      `[requestfailed] ${request.method()} ${sanitizeDiagnosticUrl(request.url())} ${errorText}`,
    );
  });
  page.on("response", (response) => {
    const request = response.request();
    const headers = request.headers();
    if (
      response.status() === 404 &&
      request.resourceType() === "fetch" &&
      headers.rsc === "1" &&
      headers["next-router-prefetch"] === "1" &&
      /^\/repo\/[^/]+\/[^/]+\/?$/.test(new URL(response.url()).pathname)
    ) {
      return;
    }
    if (
      response.status() === 401 ||
      response.status() === 403 ||
      response.status() === 404 ||
      response.status() === 429 ||
      response.status() >= 500
    ) {
      const requestContext = [
        `type=${request.resourceType()}`,
        headers.rsc === "1" ? "rsc=1" : "",
        headers["next-router-prefetch"] === "1" ? "prefetch=1" : "",
        headers["next-router-state-tree"]
          ? `tree=${headers["next-router-state-tree"].slice(0, 500)}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      record(
        `[response:${response.status()}] ${request.method()} ${sanitizeDiagnosticUrl(response.url())} ${requestContext}`,
      );
    }
  });
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const expected = process.env.BASE_URL;
    if (!expected) return;
    try {
      const allowedOrigins = new Set([
        new URL(expected).origin,
        ...(process.env.E2E_ALLOWED_NAVIGATION_ORIGINS ?? "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      ]);
      if (!allowedOrigins.has(new URL(frame.url()).origin)) {
        record(
          `[navigation] unexpected origin ${sanitizeDiagnosticUrl(frame.url())}`,
        );
      }
    } catch {
      record("[navigation] invalid target URL");
    }
  });
}

export const test = base.extend<{
  liveKodyAccountSession: void;
  livePageMonitoring: void;
}>({
  liveKodyAccountSession: [
    async ({ page }, use) => {
      const baseUrl = process.env.BASE_URL ?? "";
      if (!baseUrl) throw new Error("Kody Quality requires BASE_URL");
      const authBaseUrl = process.env.E2E_AUTH_BASE_URL?.trim() || baseUrl;
      const credentials = await loadLiveKodyAccountCredentialsFromDashboard(
        page.request,
        baseUrl,
        process.env,
      );
      await establishLiveKodyAccountSession(
        page.request,
        authBaseUrl,
        credentials,
        process.env.E2E_AUTH_ORIGIN,
      );
      if (new URL(authBaseUrl).origin !== new URL(baseUrl).origin) {
        const sessionCookies = await page.context().cookies(authBaseUrl);
        if (sessionCookies.length === 0) {
          throw new Error("Trusted Kody sign-in returned no session cookie");
        }
        await page.context().addCookies(
          sessionCookies.map(({ domain: _domain, path: _path, ...cookie }) => ({
            ...cookie,
            url: new URL(baseUrl).origin,
          })),
        );
        const copiedCookies = await page.context().cookies(baseUrl);
        const session = await page.request.get(`${baseUrl}/api/auth/get-session`);
        const sessionBody = (await session.json().catch(() => null)) as {
          user?: { id?: unknown };
        } | null;
        if (!session.ok() || typeof sessionBody?.user?.id !== "string") {
          throw new Error(
            `Preview Kody session was not established (${session.status()}); response keys: ${Object.keys(sessionBody ?? {}).join(", ") || "none"}; copied cookies: ${copiedCookies.map(({ name }) => name).join(", ") || "none"}`,
          );
        }
      }
      await use();
    },
    { auto: true },
  ],
  livePageMonitoring: [
    async ({ page }, use, testInfo) => {
      const diagnostics: string[] = [];
      monitorPage(page, diagnostics);
      await use();

      if (diagnostics.length === 0) return;
      await testInfo.attach("live-browser-diagnostics", {
        body: Buffer.from(`${JSON.stringify(diagnostics, null, 2)}\n`),
        contentType: "application/json",
      });

      if (testInfo.errors.length === 0) {
        throw new Error(
          `Live browser monitoring found ${diagnostics.length} unexpected error${diagnostics.length === 1 ? "" : "s"}:\n${diagnostics.join("\n")}`,
        );
      }
    },
    { auto: true },
  ],
});

export async function resolveLiveGitHubUser(
  page: Page,
  baseUrl: string,
  headers: Record<string, string>,
): Promise<{ login: string; avatar_url: string; id: number }> {
  const response = await page.request.get(`${baseUrl}/api/kody/auth/me`, {
    headers,
  });
  const body = (await response.json().catch(() => null)) as {
    authenticated?: boolean;
    user?: { login?: string; avatar_url?: string; githubId?: number };
  } | null;
  if (!response.ok() || !body?.authenticated || !body.user?.login) {
    throw new Error(
      `Unable to resolve the live GitHub actor (${response.status()})`,
    );
  }
  return {
    login: body.user.login,
    avatar_url: body.user.avatar_url ?? "",
    id: body.user.githubId ?? 0,
  };
}

export { expect };
export type { Page, Request } from "@playwright/test";
