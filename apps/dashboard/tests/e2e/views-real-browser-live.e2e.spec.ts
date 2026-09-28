/**
 * @testFramework playwright
 * @domain views-browser-live
 * @description Non-mutating mounted Views journey through the real Dashboard,
 * repository vault, Fly Machine, Chromium page stream, and browser controls.
 */
import { expect, test } from "@playwright/test";

import {
  establishLiveKodyAccountSession,
  loadLiveKodyAccountCredentialsFromDashboard,
} from "./live-account-session";

const BASE_URL = process.env.BASE_URL ?? "";
const TOKEN =
  process.env.KODY_LIVE_GITHUB_TOKEN ??
  process.env.E2E_GITHUB_TOKEN ??
  process.env.GITHUB_TOKEN ??
  process.env.GH_TOKEN ??
  "";
const [OWNER, REPO] = (
  process.env.LIVE_BROWSER_REPOSITORY ?? "aharonyaircohen/kody-chat"
).split("/");
const TASK_NUMBER = Number(process.env.LIVE_BROWSER_TASK_NUMBER ?? "142");

test("runs Fly actions, switches saved views, and opens a Dashboard task", async ({
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(
    !BASE_URL || !TOKEN || !OWNER || !REPO,
    "Requires a live local target and GitHub token",
  );

  const headers = {
    "x-kody-token": TOKEN,
    "x-kody-owner": OWNER!,
    "x-kody-repo": REPO!,
  };
  const credentials = await loadLiveKodyAccountCredentialsFromDashboard(
    page.request,
    BASE_URL,
    process.env,
  );
  await establishLiveKodyAccountSession(page.request, BASE_URL, credentials);

  const [identityResponse, configResponse] = await Promise.all([
    page.request.get(`${BASE_URL}/api/kody/auth/me`, { headers }),
    page.request.get(`${BASE_URL}/api/kody/dashboard-config`, { headers }),
  ]);
  expect(identityResponse.ok(), "Live GitHub identity must resolve").toBe(true);
  expect(configResponse.ok(), "Saved views must load").toBe(true);
  const identity = (await identityResponse.json()) as {
    user?: { login?: string; avatar_url?: string; githubId?: number };
  };
  const config = (await configResponse.json()) as {
    config?: {
      namedPreviews?: Array<{ id: string; label: string; url?: string }>;
    };
  };
  const previews = (config.config?.namedPreviews ?? []).filter(
    (preview): preview is { id: string; label: string; url: string } =>
      Boolean(preview.id && preview.label && preview.url),
  );
  expect(
    previews.length,
    "The live repository needs a saved URL view",
  ).toBeGreaterThanOrEqual(1);
  const primary = previews[0]!;
  const primaryAddress = new URL(primary.url).href;
  const automationUrl = "https://www.iana.org/help/example-domains";
  const automationOrigin = new URL(automationUrl).origin;
  const actorLogin = identity.user?.login;
  expect(actorLogin, "Live GitHub identity must include a login").toBeTruthy();

  await page.addInitScript(
    ({ auth, defaultModelKey }) => {
      localStorage.setItem("kody_auth", JSON.stringify(auth));
      localStorage.setItem(defaultModelKey, "kody:test/model");
    },
    {
      defaultModelKey: `kody-default-chat-entry:${OWNER}/${REPO}`,
      auth: {
        repoUrl: `https://github.com/${OWNER}/${REPO}`,
        owner: OWNER,
        repo: REPO,
        token: TOKEN,
        user: {
          login: actorLogin!,
          avatar_url: identity.user?.avatar_url ?? "",
          id: identity.user?.githubId ?? 0,
        },
        loggedInAt: Date.now(),
      },
    },
  );
  await page.route("**/api/kody/models", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [{ id: "test/model", label: "Kody Test", enabled: true }],
      }),
    }),
  );
  const browserActions: Array<{
    type: string;
    url?: string;
    status?: number;
    response?: string;
  }> = [];
  page.on("request", (request) => {
    if (
      request.method() !== "POST" ||
      !request.url().includes("/api/kody/browser/session")
    ) {
      return;
    }
    const body = request.postDataJSON() as {
      operation?: string;
      action?: { type?: string; url?: string };
    };
    if (body.operation !== "act" || !body.action?.type) return;
    browserActions.push({ type: body.action.type, url: body.action.url });
  });
  page.on("response", async (response) => {
    if (
      response.request().method() !== "POST" ||
      !response.url().includes("/api/kody/browser/session")
    ) {
      return;
    }
    const pending = [...browserActions]
      .reverse()
      .find((action) => action.status === undefined);
    if (!pending) return;
    pending.status = response.status();
    pending.response = response.ok()
      ? "ok"
      : await response.text().catch(() => "unreadable");
  });
  let chatTurns = 0;
  await page.route("**/api/kody/chat/kody", async (route) => {
    chatTurns += 1;
    const body =
      chatTurns === 1
        ? [
            'data: {"type":"data-chat-output-contract","data":{"mode":"exclusive-tool"}}',
            'data: {"type":"tool-input-available","toolCallId":"browser-action","toolName":"browser_capability_act","input":{}}',
            `data: ${JSON.stringify({
              type: "tool-output-available",
              toolCallId: "browser-action",
              output: {
                action: "preview_act",
                capabilitySlug: "live-browser-bridge-test",
                allowedOrigins: [automationOrigin],
                op: "navigate",
                url: automationUrl,
                reason: "verify the active Fly browser",
              },
            })}`,
            'data: {"type":"finish"}',
            "data: [DONE]",
            "",
          ].join("\n\n")
        : chatTurns === 2
          ? [
              'data: {"type":"data-chat-output-contract","data":{"mode":"exclusive-tool"}}',
              'data: {"type":"tool-input-available","toolCallId":"navigation-done","toolName":"final_answer","input":{"content":"Fly navigation complete"}}',
              'data: {"type":"tool-output-available","toolCallId":"navigation-done","output":{"content":"Fly navigation complete"}}',
              'data: {"type":"finish"}',
              "data: [DONE]",
              "",
            ].join("\n\n")
          : chatTurns === 3
            ? [
                'data: {"type":"data-chat-output-contract","data":{"mode":"exclusive-tool"}}',
                'data: {"type":"tool-input-available","toolCallId":"browser-scroll","toolName":"browser_capability_act","input":{}}',
                `data: ${JSON.stringify({
                  type: "tool-output-available",
                  toolCallId: "browser-scroll",
                  output: {
                    action: "preview_act",
                    capabilitySlug: "live-browser-bridge-test",
                    allowedOrigins: [automationOrigin],
                    op: "scroll",
                    dy: 420,
                    reason: "verify scrolling in the active Fly browser",
                  },
                })}`,
                'data: {"type":"finish"}',
                "data: [DONE]",
                "",
              ].join("\n\n")
            : chatTurns === 4
              ? [
                  'data: {"type":"data-chat-output-contract","data":{"mode":"exclusive-tool"}}',
                  'data: {"type":"tool-input-available","toolCallId":"done","toolName":"final_answer","input":{"content":"Fly scroll complete"}}',
                  'data: {"type":"tool-output-available","toolCallId":"done","output":{"content":"Fly scroll complete"}}',
                  'data: {"type":"finish"}',
                  "data: [DONE]",
                  "",
                ].join("\n\n")
              : [
                  'data: {"type":"data-chat-output-contract","data":{"mode":"exclusive-tool"}}',
                  `data: ${JSON.stringify({
                    type: "tool-input-available",
                    toolCallId: "open-task",
                    toolName: "dashboard_navigate",
                    input: {
                      routeId: "task",
                      issueNumber: TASK_NUMBER,
                      reason: `Open task ${TASK_NUMBER}`,
                    },
                  })}`,
                  `data: ${JSON.stringify({
                    type: "tool-output-available",
                    toolCallId: "open-task",
                    output: {
                      action: "dashboard_navigate",
                      routeId: "task",
                      href: `/${TASK_NUMBER}`,
                      label: `Task #${TASK_NUMBER}`,
                      reason: `Open task ${TASK_NUMBER}`,
                    },
                  })}`,
                  'data: {"type":"finish"}',
                  "data: [DONE]",
                  "",
                ].join("\n\n");
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body,
    });
  });

  await page.goto(`${BASE_URL}/repo/${OWNER}/${REPO}/preview/${primary.id}`, {
    waitUntil: "domcontentloaded",
  });
  const surface = page.locator("[data-remote-browser-surface]");
  const address = page.getByLabel("Current preview URL");
  await expect(surface).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Starting browser…")).toBeHidden({
    timeout: 60_000,
  });
  await expect(address).toHaveValue(primaryAddress, { timeout: 60_000 });

  const sessionResponse = await page.request.get(
    `${BASE_URL}/api/kody/browser/session?actorLogin=${encodeURIComponent(actorLogin!)}`,
    { headers },
  );
  expect(sessionResponse.ok(), "Active browser session must resolve").toBe(
    true,
  );
  const session = (await sessionResponse.json()) as { sessionId?: string };
  expect(
    session.sessionId,
    "Active browser session must have an id",
  ).toBeTruthy();
  const browserAction = async (action: Record<string, unknown>) => {
    const response = await page.request.post(
      `${BASE_URL}/api/kody/browser/session`,
      {
        headers,
        data: {
          operation: "act",
          actorLogin,
          sessionId: session.sessionId,
          action,
        },
      },
    );
    expect(
      response.ok(),
      `Browser action ${String(action.type)} must pass`,
    ).toBe(true);
    return (await response.json()) as { data?: unknown };
  };

  await browserAction({
    type: "navigate",
    url: "https://httpbin.org/forms/post",
  });
  await browserAction({
    type: "fill",
    selector: "input[name=custname]",
    value: "shortcut-copy",
  });
  await browserAction({ type: "click", selector: "input[name=custname]" });
  await surface.focus();
  await page.keyboard.press("Meta+a");
  await page.keyboard.press("Meta+c");
  await browserAction({
    type: "fill",
    selector: "input[name=custname]",
    value: "",
  });
  await browserAction({ type: "click", selector: "input[name=custname]" });
  await browserAction({ type: "recordStart" });
  await surface.focus();
  await page.keyboard.press("Meta+v");
  await browserAction({ type: "click", selector: "body" });
  const pasteRecording = await browserAction({ type: "recordStop" });
  expect(JSON.stringify(pasteRecording.data)).toContain("shortcut-copy");

  const beforeZoom = await browserAction({ type: "screenshot" });
  await surface.focus();
  await page.keyboard.down("Meta");
  await page.keyboard.press("+");
  await page.keyboard.up("Meta");
  await expect
    .poll(async () =>
      JSON.stringify((await browserAction({ type: "screenshot" })).data),
    )
    .not.toBe(JSON.stringify(beforeZoom.data));

  const chat = page.locator('[aria-label="Kody chat"]').first();
  await chat.getByRole("button", { name: "New conversation" }).click();
  const composer = chat.locator("textarea").first();
  await expect(composer).toBeEditable();
  await composer.fill("Run the non-mutating Fly browser bridge check");
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect(address).toHaveValue(automationUrl, { timeout: 60_000 });
  await expect(
    chat.getByText("Fly navigation complete", { exact: true }).last(),
  ).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => chatTurns, { timeout: 30_000 }).toBe(2);

  const beforeScroll = await surface.screenshot();
  await composer.fill("Scroll down in the current Fly browser page");
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect.poll(() => chatTurns, { timeout: 30_000 }).toBe(4);
  await expect
    .poll(
      async () => Buffer.compare(beforeScroll, await surface.screenshot()),
      {
        timeout: 30_000,
      },
    )
    .not.toBe(0);
  await expect(
    chat.getByText("Fly scroll complete", { exact: true }).last(),
  ).toBeVisible({ timeout: 30_000 });

  const primaryNavigationsBeforeReselect = browserActions.filter(
    (action) => action.type === "navigate" && action.url === primary.url,
  ).length;
  await page.getByTitle(/Switch preview environment/).click();
  await page
    .getByRole("button", {
      name: `${primary.label} ${primary.url}`,
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(new RegExp(`/preview/${primary.id}$`));
  await expect
    .poll(
      () =>
        browserActions.filter(
          (action) => action.type === "navigate" && action.url === primary.url,
        ).length,
      { timeout: 60_000 },
    )
    .toBe(primaryNavigationsBeforeReselect + 1);
  await expect(address).toHaveValue(primaryAddress, { timeout: 60_000 });
  await expect(page.getByText("Starting browser…")).toBeHidden();

  const back = page.getByLabel("Go back in preview");
  await expect(back).toBeEnabled({ timeout: 30_000 });
  await back.click();
  await expect(address).toHaveValue(automationUrl, { timeout: 30_000 });
  const forward = page.getByLabel("Go forward in preview");
  await expect(forward).toBeEnabled({ timeout: 30_000 });
  await forward.click();
  await expect(address).toHaveValue(primaryAddress, { timeout: 30_000 });

  await page.getByLabel("Inspector actions").click();
  await page.getByRole("menuitem", { name: "Pick element" }).click();
  await expect(surface).toBeVisible();
  await expect
    .poll(
      () =>
        surface.evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          return canvas.width > 0 && canvas.height > 0;
        }),
      { timeout: 30_000 },
    )
    .toBe(true);

  const remoteNavigationCount = browserActions.filter(
    (action) => action.type === "navigate",
  ).length;
  await composer.fill(`Open task ${TASK_NUMBER}`);
  await chat.getByRole("button", { name: "Send message" }).click();
  await expect(page).toHaveURL(
    `${BASE_URL}/repo/${OWNER}/${REPO}/${TASK_NUMBER}`,
    { timeout: 30_000 },
  );
  await expect(page.getByText("404", { exact: true })).toHaveCount(0);
  expect(
    browserActions.filter((action) => action.type === "navigate"),
  ).toHaveLength(remoteNavigationCount);
});
