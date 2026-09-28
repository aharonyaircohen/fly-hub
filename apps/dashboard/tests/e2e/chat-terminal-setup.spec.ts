/**
 * @fileoverview Browser contract for visible Brain terminal setup failures.
 * @testFramework playwright
 * @domain terminal
 */
import { expect, test, type Page } from "@playwright/test";
import {
  mockDashboardShellRequests,
  mockKodyAccountSession,
} from "./support/dashboard-shell-mocks";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3333";

test("local terminal failure waits for an explicit restart", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/api/kody/**", (route) => route.fulfill({ json: {} }));
  await mockDashboardShellRequests(page);
  await seedAuth(page);
  let historyReads = 0;
  await page.route("**/api/kody/chat/terminal/checkpoint?**", (route) => {
    historyReads += 1;
    return route.fulfill({
      json: { checkpoint: { output: "OLD_CONNECTION_NOISE" } },
    });
  });
  await page.route("**/api/kody/brain/status", (route) =>
    route.fulfill({
      json: {
        machines: [
          {
            feature: "brain",
            app: "terminal-e2e",
            machineId: "brain-1",
            state: "started",
            region: "fra",
            label: "Brain",
          },
        ],
      },
    }),
  );
  let starts = 0;
  const message =
    "Local terminal is unavailable in this runtime because native PTY support could not load.";
  await page.route("**/api/kody/chat/terminal/start", (route) => {
    starts += 1;
    if (starts > 1)
      return route.fulfill({
        json: {
          session: {
            sessionId: "local-1",
            cursor: 0,
            alive: true,
            cwd: "/workspace",
            shell: "zsh",
          },
        },
      });
    return route.fulfill({
      status: 503,
      json: { error: "terminal_start_failed", message },
    });
  });
  const delivered: string[] = [];
  await page.route("**/api/kody/chat/terminal/input", async (route) => {
    const { input } = route.request().postDataJSON();
    if (input === "p") await new Promise((resolve) => setTimeout(resolve, 250));
    delivered.push(input);
    if (input === "x")
      return route.fulfill({ status: 503, json: { error: "input_failed" } });
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/kody/chat/terminal/output?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const initial =
      new URL(route.request().url()).searchParams.get("cursor") === "0";
    await route.fulfill({
      json: {
        events: initial
          ? [
              {
                id: 1,
                type: "output",
                data: "$ ",
                at: new Date().toISOString(),
              },
            ]
          : [],
        cursor: 1,
        alive: true,
      },
    });
  });
  await page.goto(`${BASE_URL}/repo/test-owner/test-repo`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('summary[aria-label="More compose options"]').click();
  await page.getByRole("button", { name: /^Terminal / }).click();
  await expect(
    page.getByLabel("Terminal target").filter({ visible: true }),
  ).toHaveValue("brain");
  await page
    .getByLabel("Terminal target")
    .filter({ visible: true })
    .selectOption({ label: "Local terminal" });
  await expect(
    page.getByLabel("Terminal target").filter({ visible: true }),
  ).toHaveValue("local");
  await expect(page.getByTestId("terminal-startup-issue")).toContainText(
    "Local terminal is unavailable",
  );
  await expect(page.locator(".xterm-rows:visible")).not.toContainText(
    "Local terminal is unavailable",
  );
  // Observe several render cycles: a state-dependent start callback used to
  // issue another failed request on every completion.
  await page.waitForTimeout(1000);
  expect(starts).toBe(1);
  expect(historyReads).toBe(0);
  await expect(
    page.getByRole("region", { name: "Historical terminal checkpoint" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Retry terminal", exact: true })
    .click();
  await expect.poll(() => starts).toBe(2);
  await page.waitForTimeout(500);
  expect(starts).toBe(2);
  await expect(page.getByTestId("terminal-startup-issue")).not.toBeVisible();
  const input = page
    .getByRole("textbox", { name: "Terminal input", exact: true })
    .filter({ visible: true });
  await input.pressSequentially("pwd");
  await input.press("Enter");
  await expect.poll(() => delivered.join("")).toBe("pwd\r");
  await input.pressSequentially("xy");
  await expect(page.getByTestId("terminal-startup-issue")).toContainText(
    "Terminal input could not be delivered",
  );
  await page.waitForTimeout(500);
  expect(delivered.join("")).toBe("pwd\rx");
  expect(pageErrors).toEqual([]);
});

async function seedAuth(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        repoUrl: "https://github.com/test-owner/test-repo",
        owner: "test-owner",
        repo: "test-repo",
        token: "ghp_placeholder",
        user: { login: "terminal-e2e", avatar_url: "", id: 1 },
        loggedInAt: Date.now(),
      }),
    );
    localStorage.setItem("kody:chat-first-layout", "0");
  });
}

for (const scenario of ["ready", "setup", "timeout", "transport"] as const) {
  const needsSetup = scenario === "setup";
  const transientTimeout = scenario === "timeout";
  const transientTransport = scenario === "transport";
  test(`opens terminal after navigating from personal credentials without resetting the draft${needsSetup ? " after machine replacement" : transientTimeout ? " after a Fly tunnel timeout" : transientTransport ? " after a typed transport failure" : ""}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      if (request.failure()?.errorText !== "net::ERR_ABORTED") {
        errors.push(`${request.url()}: ${request.failure()?.errorText}`);
      }
    });
    await page.route("**/api/kody/**", (route) =>
      route.fulfill({
        json: {
          reports: [],
          collaborators: [],
          boards: [],
          tasks: [],
          counts: {},
        },
      }),
    );
    await mockDashboardShellRequests(page);
    await seedAuth(page);
    await page.route("**/api/kody/brain/status", (route) =>
      route.fulfill({
        json: {
          machines: [
            {
              feature: "brain",
              app: "terminal-e2e",
              machineId: "brain-1",
              state: "started",
              region: "fra",
              label: "Brain",
            },
          ],
        },
      }),
    );
    let setupDone = !needsSetup;
    await page.route("**/api/kody/terminal/setup", (route) => {
      setupDone = true;
      return route.fulfill({ json: { ok: true, machineId: "brain-2" } });
    });
    let sessionRequests = 0;
    await page.route("**/api/kody/terminal/session", (route) => {
      sessionRequests += 1;
      return route.fulfill({
        json: {
          webSocketUrl: "ws://terminal.test/session",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          session: {
            id: setupDone && needsSetup ? "terminal-2" : "terminal-1",
            scope: {
              owner: "test-owner",
              repo: "test-repo",
              conversationId: "terminal-conversation",
            },
            target: {
              kind: "brain",
              runtimeId: setupDone && needsSetup ? "brain-2" : "brain-1",
            },
          },
        },
      });
    });
    let socketConnections = 0;
    await page.routeWebSocket("ws://terminal.test/session", (socket) => {
      socketConnections += 1;
      let ready =
        setupDone &&
        !((transientTimeout || transientTransport) && socketConnections === 1);
      const sessionId = ready && needsSetup ? "terminal-2" : "terminal-1";
      let revision = 0;
      let cleared = false;
      let recoveryStarted = false;
      socket.onMessage((raw) => {
        const command = JSON.parse(String(raw));
        if (transientTransport && !ready && !recoveryStarted) {
          recoveryStarted = true;
          socket.send(
            JSON.stringify({
              type: "transport-status",
              phase: "reconnecting",
              attempt: 2,
              retryInMs: 1500,
              message: "Reconnecting to Brain…",
            }),
          );
          setTimeout(() => {
            ready = true;
            socket.send(
              JSON.stringify({
                type: "state",
                sessionId,
                generation: 1,
                state: "ready",
              }),
            );
          }, 1500);
          return;
        }
        if (ready && ["input", "clear"].includes(command.type)) {
          if (command.type === "clear") cleared = true;
          socket.send(
            JSON.stringify({
              type: "output",
              sessionId,
              generation: 1,
              revision: ++revision,
              data:
                "\x1b[3J\x1b[2J\x1b[H" +
                (command.type === "clear"
                  ? "$ "
                  : cleared
                    ? "$ ls\r\nAFTER_CLEAR\r\n$ "
                    : "$ ls\r\nHISTORY_ONCE\r\n$ "),
            }),
          );
          return;
        }
        socket.send(
          JSON.stringify(
            ready
              ? {
                  type: "state",
                  sessionId,
                  generation: 1,
                  state: "ready",
                }
              : {
                  type: "input-rejected",
                  code: needsSetup
                    ? "terminal_agent_missing"
                    : transientTransport
                      ? "terminal_transport_unavailable"
                      : undefined,
                  message: transientTransport
                    ? "Provider temporarily unavailable"
                    : transientTimeout
                      ? 'Error: tunnel unavailable: Error contacting Fly.io API when probing "personal": timed out (context deadline exceeded)'
                      : "Terminal agent is unavailable",
                },
          ),
        );
      });
    });

    // A full load on Personal Credentials initializes the persistent chat with
    // personal plugins. Returning to a repository must update that same chat.
    await page.goto(`${BASE_URL}/secrets`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: "Personal Credentials", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Keep this draft");
    await page.getByRole("link", { name: /^Kody home/ }).click();
    await expect(page).toHaveURL(`${BASE_URL}/repo/test-owner/test-repo`);
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("Keep this draft");
    await page.locator('summary[aria-label="More compose options"]').click();
    await page.getByRole("button", { name: /^Terminal / }).click();
    await expect(page.getByLabel("Terminal target")).toBeVisible();
    if (needsSetup) {
      await page
        .getByRole("button", { name: "Set up terminal", exact: true })
        .click();
      await expect(
        page.getByTestId("terminal-startup-issue"),
      ).not.toBeVisible();
    }
    if (transientTransport) {
      await expect(page.getByTestId("terminal-recovery-status")).toContainText(
        "Reconnecting to Brain",
      );
      await expect(page.getByTestId("terminal-startup-issue")).toHaveCount(0);
    }
    await expect(
      page.getByRole("button", { name: "Send command", exact: true }),
    ).toBeEnabled();
    expect(sessionRequests).toBeGreaterThan(0);
    if (transientTimeout) expect(sessionRequests).toBe(1);
    const terminalInput = page.getByRole("textbox", {
      name: "Terminal input",
      exact: true,
    });
    await terminalInput.press("l");
    await terminalInput.press("s");
    await expect(page.locator(".xterm-rows")).toContainText("HISTORY_ONCE");
    expect(
      (await page.locator(".xterm-rows").innerText()).split("HISTORY_ONCE"),
    ).toHaveLength(2);
    await page
      .getByRole("button", { name: "Clear terminal", exact: true })
      .click();
    await expect(page.locator(".xterm-rows")).not.toContainText("HISTORY_ONCE");
    await terminalInput.press("l");
    await expect(page.locator(".xterm-rows")).toContainText("AFTER_CLEAR");
    await expect(page.locator(".xterm-rows")).not.toContainText("HISTORY_ONCE");

    await page.getByRole("button", { name: "AI chat", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("Keep this draft");
    await page.getByRole("button", { name: "Personal", exact: true }).click();
    await page
      .getByRole("link", { name: "Personal Credentials", exact: true })
      .click();
    await expect(page).toHaveURL(`${BASE_URL}/secrets`);
    await expect(
      page.getByRole("button", { name: /^Terminal / }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue("Keep this draft");
    await page.getByRole("button", { name: /^Terminal / }).click();
    await expect(page.getByLabel("Terminal target")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send command", exact: true }),
    ).toBeEnabled();
    expect(errors).toEqual([]);
  });
}

test("shows setup and credential recovery instead of a blank Brain terminal", async ({
  page,
}) => {
  await mockKodyAccountSession(page, {
    id: "terminal-e2e",
    name: "Terminal E2E",
  });
  await page.route("**/api/kody/chat/conversations**", (route) =>
    route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        route.request().method() === "POST"
          ? { conversationId: "terminal-conversation" }
          : { conversations: [] },
      ),
    }),
  );
  await page.route("**/api/kody/models*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ models: [] }),
    }),
  );
  await page.route("**/api/kody/brain/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        running: 1,
        total: 1,
        machines: [
          {
            feature: "brain",
            app: "kody-brain-terminal-e2e",
            machineId: "brain-1",
            state: "started",
            region: "fra",
            label: "Brain",
            sizeLabel: "performance-1x",
            orgSlug: "personal",
          },
        ],
      }),
    }),
  );
  await page.route("**/api/kody/terminal/session", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "terminal_gateway_not_ready",
        message: "Terminal setup is required for this Brain.",
      }),
    }),
  );
  let setupRequests = 0;
  await page.route("**/api/kody/terminal/setup", (route) => {
    setupRequests += 1;
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: "fly_access_denied",
        message: "Fly token cannot access this Brain app.",
      }),
    });
  });

  await seedAuth(page);
  await page.goto(`${BASE_URL}/repo/test-owner/test-repo/tasks`, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('summary[aria-label="More compose options"]').click();
  await page.getByRole("button", { name: /^Terminal / }).click();
  const target = page.getByLabel("Terminal target");
  await expect(target).toBeVisible();
  await target.selectOption("brain");

  const issue = page.getByTestId("terminal-startup-issue");
  await expect(issue).toContainText("Terminal setup required");
  await expect(page.getByLabel("Restart terminal").first()).toBeDisabled();
  await issue.getByRole("button", { name: "Set up terminal" }).click();

  await expect.poll(() => setupRequests).toBe(1);
  await expect(issue).toContainText("Brain access needs attention");
  await expect(
    issue.getByRole("link", { name: "Open Secrets" }),
  ).toHaveAttribute("href", "/repo/test-owner/test-repo/secrets");
  // The failure overlay must not cover the composer's mode buttons.
  await page
    .getByRole("button", { name: "AI chat", exact: true })
    .click({ timeout: 5000 });
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toBeVisible();
});
