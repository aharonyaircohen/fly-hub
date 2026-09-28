import type { Page, Route } from "@playwright/test";

type ShellResponse = Readonly<Record<string, unknown>>;

const SHELL_RESPONSES: Readonly<Record<string, ShellResponse>> = {
  "/api/kody/agents": { agent: [] },
  "/api/kody/brain/models": { models: [] },
  "/api/kody/commands": { commands: [] },
  "/api/kody/dashboard-config": { config: {} },
  "/api/kody/engine/status": {
    status: "ready",
    files: { workflow: "present", config: "present" },
  },
  "/api/kody/file-spaces": { spaces: [] },
  "/api/kody/navigation-favorites": { favoriteHrefs: [] },
  "/api/kody/models": { models: [] },
  "/api/kody/secrets": { secrets: [] },
  "/api/webhooks/register": { ok: true },
};

function fulfillJson(route: Route, body: ShellResponse) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function mockKodyAccountSession(
  page: Page,
  user: {
    id?: string;
    name?: string;
    email?: string;
    githubLogin?: string;
  } = {},
): Promise<void> {
  const id = user.id ?? "kody-e2e-user";
  const githubLogin = user.githubLogin ?? "test-owner";
  await page.addInitScript(() => {
    window.setTimeout(() => {
      try {
        const repositoryAuth = localStorage.getItem("kody_auth");
        if (repositoryAuth) {
          localStorage.setItem("kody_e2e_account_auth", repositoryAuth);
        }
      } catch {
        // Sandboxed preview iframes intentionally have no storage access.
      }
    }, 0);
  });
  await page.route("**/api/auth/get-session", (route) =>
    fulfillJson(route, {
      session: {
        id: "kody-e2e-session",
        userId: id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
      user: {
        id,
        name: user.name ?? "Kody E2E",
        email: user.email ?? "kody-e2e@example.test",
        emailVerified: true,
      },
    }),
  );
  await page.route("**/api/auth/convex/token", (route) =>
    fulfillJson(route, { token: null }),
  );
  await page.route("**/api/kody/auth/me", (route) =>
    fulfillJson(route, {
      authenticated: true,
      user: { login: githubLogin, avatar_url: "", githubId: 1 },
      owner: "test-owner",
      repo: "test-repo",
    }),
  );
  await page.route("**/api/kody/account/repositories", async (route) => {
    if (route.request().method() !== "GET") {
      return fulfillJson(route, { ok: true });
    }
    const auth = await page
      .evaluate(() => {
        const stored =
          localStorage.getItem("kody_e2e_account_auth") ??
          localStorage.getItem("kody_auth");
        return stored ? (JSON.parse(stored) as unknown) : null;
      })
      .catch(() => null);
    return fulfillJson(route, { auth });
  });
}

/**
 * Isolates mocked page journeys from persistence used by shared dashboard
 * chrome. Register feature-specific routes after this helper so their own
 * stateful mocks remain authoritative.
 */
export async function mockDashboardShellRequests(page: Page): Promise<void> {
  await mockKodyAccountSession(page);
  await Promise.all(
    Object.entries(SHELL_RESPONSES).map(([pathname, response]) =>
      page.route((url) => url.pathname === pathname, (route) => fulfillJson(route, response)),
    ),
  );
  await page.route("**/api/kody/chat/machines**", (route) =>
    fulfillJson(route, { local: false }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const isCollection = pathname.endsWith("/conversations");
    if (request.method() === "GET" && isCollection) {
      return fulfillJson(route, { conversations: [] });
    }
    if (request.method() === "GET") {
      return fulfillJson(route, {
        conversation: null,
        entries: [],
        checkpoints: [],
        runtimeBindings: [],
        attachments: [],
      });
    }
    return route.fulfill({
      status: request.method() === "POST" && isCollection ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
}
