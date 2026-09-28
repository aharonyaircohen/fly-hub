/**
 * @testFramework playwright
 * @domain views-browser-mocked
 * @description Mounted Views journey with the Fly API and page stream mocked at
 * their network boundaries. The browser image itself is covered by smoke-test.mjs.
 */
import {
  expect,
  test,
  type Route,
  type WebSocketRoute,
} from "@playwright/test";

import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const FRAME =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ED//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ED//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/ED//2Q==";

function binaryFrame(frameId: number): Buffer {
  const jpeg = Buffer.from(FRAME, "base64");
  const packet = Buffer.alloc(8 + jpeg.byteLength);
  packet.write("KBF1", 0, "ascii");
  packet.writeUInt32BE(frameId, 4);
  jpeg.copy(packet, 8);
  return packet;
}

const auth = {
  repoUrl: "https://github.com/test-owner/test-repo",
  owner: "test-owner",
  repo: "test-repo",
  token: "ghp_placeholder",
  user: { login: "browser-e2e", avatar_url: "", id: 1 },
  loggedInAt: Date.now(),
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

test("bookmarks, browser controls, picker, URL saving, and stream state stay aligned", async ({
  page,
}) => {
  const environments = [
    { id: "kody", label: "Kody", url: "https://kody.example/app" },
    {
      id: "iana",
      label: "IANA",
      url: "https://www.iana.org/help/example-domains",
    },
    {
      id: "existing-docs",
      label: "example.com docs",
      url: "https://different.example/docs",
    },
  ];
  const history = [environments[0]!.url];
  let historyIndex = 0;
  let revision = 1;
  let stream: WebSocketRoute | null = null;
  let rejectStreams = false;
  let streamConnections = 0;
  let sessionStarts = 0;
  let sessionResumes = 0;
  let sessionReads = 0;
  let sessionExists = false;
  const actions: Array<Record<string, unknown>> = [];
  const streamInputs: Array<Record<string, unknown>> = [];

  const pageState = () => ({
    url: history[historyIndex]!,
    title: new URL(history[historyIndex]!).hostname,
    loading: false,
    canGoBack: historyIndex > 0,
    canGoForward: historyIndex < history.length - 1,
    revision,
    viewport: { width: 1280, height: 720 },
  });
  const sendState = () => {
    if (!stream) return;
    stream.send(JSON.stringify({ type: "state", page: pageState() }));
  };

  await page.addInitScript((value) => {
    localStorage.setItem("kody_auth", JSON.stringify(value));
  }, auth);
  await mockDashboardShellRequests(page);
  await page.unroute("**/api/kody/dashboard-config");
  await page.route("**/api/kody/dashboard-config", async (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as {
        namedPreviews?: typeof environments;
      };
      environments.splice(
        0,
        environments.length,
        ...(body.namedPreviews ?? environments),
      );
    }
    return json(route, { config: { version: 1, namedPreviews: environments } });
  });

  await page.routeWebSocket(/browser\.example\.test\/stream/, (socket) => {
    streamConnections += 1;
    stream = socket;
    if (rejectStreams) {
      setTimeout(() => void socket.close({ code: 1012 }), 20);
      return;
    }
    socket.onMessage((raw) => {
      const message = JSON.parse(raw.toString()) as Record<string, unknown>;
      streamInputs.push(message);
      if (message.type === "requestState") sendState();
      if (message.type === "viewport") {
        socket.send(
          JSON.stringify({
            type: "state",
            page: {
              ...pageState(),
              viewport: { width: message.width, height: message.height },
            },
          }),
        );
      }
    });
    setTimeout(() => {
      socket.send(JSON.stringify({ type: "ready" }));
      sendState();
      socket.send(binaryFrame(1));
    }, 20);
  });

  await page.route("**/api/kody/browser/session**", async (route) => {
    const request = route.request();
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    if (!body) sessionReads += 1;
    if (!body && !sessionExists) {
      return json(route, { mode: "remote", state: "idle" });
    }
    if (body?.operation === "resume") {
      sessionResumes += 1;
      return json(route, { error: "browser_operation_failed" }, 500);
    }
    if (!body || body.operation === "start") {
      if (body?.operation === "start") {
        sessionExists = true;
        sessionStarts += 1;
      }
      return json(route, {
        mode: "remote",
        sessionId: "browser-e2e",
        state: "running",
        currentUrl: pageState().url,
        viewport: pageState().viewport,
        streamUrl: "wss://browser.example.test/stream?ticket=test",
        directUrl: "https://browser.example.test/direct?ticket=test",
        uploadUrl: "https://browser.example.test/upload?ticket=test",
        ticketExpiresAt: Math.floor(Date.now() / 1000) + 300,
      });
    }
    const action = body.action as Record<string, unknown>;
    actions.push(action);
    if (action.type === "navigate") {
      history.splice(historyIndex + 1);
      history.push(String(action.url));
      historyIndex = history.length - 1;
      revision += 1;
    } else if (action.type === "back" && historyIndex > 0) {
      historyIndex -= 1;
      revision += 1;
    } else if (action.type === "forward" && historyIndex < history.length - 1) {
      historyIndex += 1;
      revision += 1;
    }
    sendState();
    return json(route, {
      ok: true,
      url: pageState().url,
      title: pageState().title,
      page: pageState(),
      ...(action.type === "pick" ? { data: { armed: true } } : {}),
      ...(action.type === "pickResult" ? { data: { element: null } } : {}),
      ...(action.type === "snapshot"
        ? { data: { snapshot: { text: "Visible page", elements: [] } } }
        : {}),
    });
  });
  await page
    .context()
    .route("https://browser.example.test/direct**", async (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Direct browser</title>",
      }),
    );

  await page.goto("/repo/test-owner/test-repo/preview/kody");
  const address = page.getByLabel("Current preview URL");
  await expect(page.locator("[data-remote-browser-surface]")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open direct login" }),
  ).toBeVisible();
  const readsBeforeDirectLogin = sessionReads;
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open direct login" }).click();
  const directLoginPopup = await popupPromise;
  await expect.poll(() => sessionReads).toBeGreaterThan(readsBeforeDirectLogin);
  await expect
    .poll(() => directLoginPopup.url())
    .toBe("https://browser.example.test/direct?ticket=test");
  await directLoginPopup.close();
  await expect(address).toHaveValue("https://kody.example/app");

  await page.getByTitle(/Switch preview environment/).click();
  await page
    .getByRole("button", { name: "IANA https://www.iana.org/" })
    .click();
  await expect(page).toHaveURL(/\/preview\/iana$/);
  await expect
    .poll(() =>
      actions.some(
        (action) =>
          action.type === "navigate" &&
          action.url === "https://www.iana.org/help/example-domains",
      ),
    )
    .toBe(true);
  await expect(address).toHaveValue(
    "https://www.iana.org/help/example-domains",
  );
  await expect.poll(() => sessionStarts).toBe(1);

  // A browser refresh can briefly mount an old/invalid route id while the
  // saved-view list is loading. The last selected bookmark must win instead
  // of falling back to the first saved view.
  await page.goto("/repo/test-owner/test-repo/preview/removed-bookmark");
  await expect(page).toHaveURL(/\/preview\/iana$/);
  await expect(address).toHaveValue(
    "https://www.iana.org/help/example-domains",
  );

  // Reconnecting to the current bookmark must not add another history entry.
  expect(history).toEqual([
    "https://kody.example/app",
    "https://www.iana.org/help/example-domains",
  ]);

  await expect(page.getByLabel("Go back in preview")).toBeEnabled({
    timeout: 5_000,
  });
  await page.getByLabel("Go back in preview").click();
  await expect(address).toHaveValue("https://kody.example/app");
  await page.getByLabel("Go forward in preview").click();
  await expect(address).toHaveValue(
    "https://www.iana.org/help/example-domains",
  );

  await address.fill("https://example.com/docs");
  await address.press("Enter");
  await expect(address).toHaveValue("https://example.com/docs");
  await page.getByTitle("Switch preview environment").click();
  await expect(
    page.locator('[role="option"][aria-selected="true"]'),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByLabel("Save current URL as environment").click();
  await expect
    .poll(() => environments.at(-1)?.label)
    .toBe("example.com docs 2");
  expect(environments.at(-1)?.url).toBe("https://example.com/docs");
  await expect(page).toHaveURL(/\/preview\/example-com-docs-2-[a-z0-9]+$/);
  await expect(page.locator("[data-remote-browser-surface]")).toBeVisible();

  // Verify and dismiss save feedback before using the toolbar beneath it.
  // Hovering a toast pauses its timer, so clicking through it can wait forever.
  const savedNotice = page.locator("[data-sonner-toast]").filter({
    hasText: 'Saved "example.com docs 2"',
  });
  await expect(savedNotice).toBeVisible();
  await savedNotice.getByRole("button", { name: "Close toast" }).click();
  await expect(savedNotice).toBeHidden();

  await page.getByLabel("Refresh preview").click();
  await expect
    .poll(() => actions.some((action) => action.type === "reload"))
    .toBe(true);

  await page.getByLabel("Switch preview viewport").click();
  await page.getByRole("option", { name: "Mobile" }).click();
  await expect
    .poll(() =>
      actions.some(
        (action) => action.type === "viewport" && action.width === 390,
      ),
    )
    .toBe(true);

  await page.getByLabel("Inspector actions").click();
  await page.getByRole("menuitem", { name: "Pick element" }).click();
  await expect
    .poll(() => actions.some((action) => action.type === "pick"))
    .toBe(true);

  await page.locator("[data-remote-browser-surface]").dispatchEvent("wheel", {
    deltaX: 0,
    deltaY: 120,
    clientX: 10,
    clientY: 10,
  });
  await expect
    .poll(() =>
      streamInputs.some(
        (input) => input.type === "pointer" && input.action === "wheel",
      ),
    )
    .toBe(true);

  const streamsBeforeFailure = streamConnections;
  rejectStreams = true;
  await (stream as WebSocketRoute | null)?.close({ code: 1012 });
  await expect(page.getByText("Browser unavailable")).toBeVisible({
    timeout: 8_000,
  });
  await page.waitForTimeout(1_500);
  expect(streamConnections).toBe(streamsBeforeFailure + 3);
  expect(sessionStarts).toBe(1);
  expect(sessionResumes).toBe(1);
});
