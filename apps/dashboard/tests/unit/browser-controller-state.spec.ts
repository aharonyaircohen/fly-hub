import { describe, expect, it } from "vitest";

import {
  browserControllerReducer,
  initialBrowserControllerState,
  type BrowserPageState,
} from "@dashboard/lib/previews/browser-controller-state";

const page = (url: string, revision = 1): BrowserPageState => ({
  url,
  title: new URL(url).hostname,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  revision,
});

describe("browser controller state", () => {
  it("activates a saved View only after Chromium commits its navigation", () => {
    const current = browserControllerReducer(initialBrowserControllerState, {
      type: "sessionReady",
      page: page("https://first.example"),
      environmentId: "first",
    });
    const requested = browserControllerReducer(current, {
      type: "navigationRequested",
      requestId: 7,
      environmentId: "second",
      url: "https://second.example",
    });

    expect(requested.phase).toBe("navigating");
    expect(requested.activeEnvironmentId).toBe("first");
    expect(requested.requestedEnvironmentId).toBe("second");
    expect(requested.page.url).toBe("https://first.example");

    const committed = browserControllerReducer(requested, {
      type: "navigationCommitted",
      requestId: 7,
      page: page("https://second.example", 2),
    });
    expect(committed.phase).toBe("ready");
    expect(committed.activeEnvironmentId).toBe("second");
    expect(committed.requestedEnvironmentId).toBeNull();
    expect(committed.page.url).toBe("https://second.example");
  });

  it("ignores a stale navigation result after a newer View was selected", () => {
    const first = browserControllerReducer(initialBrowserControllerState, {
      type: "navigationRequested",
      requestId: 1,
      environmentId: "first",
      url: "https://first.example",
    });
    const second = browserControllerReducer(first, {
      type: "navigationRequested",
      requestId: 2,
      environmentId: "second",
      url: "https://second.example",
    });
    const stale = browserControllerReducer(second, {
      type: "navigationCommitted",
      requestId: 1,
      page: page("https://first.example"),
    });

    expect(stale).toEqual(second);
  });

  it("keeps the visible page active when requested View navigation fails", () => {
    const ready = browserControllerReducer(initialBrowserControllerState, {
      type: "sessionReady",
      page: page("https://working.example"),
      environmentId: "working",
    });
    const requested = browserControllerReducer(ready, {
      type: "navigationRequested",
      requestId: 3,
      environmentId: "broken",
      url: "https://broken.example",
    });
    const failed = browserControllerReducer(requested, {
      type: "navigationFailed",
      requestId: 3,
      error: "navigation_failed",
    });

    expect(failed.phase).toBe("error");
    expect(failed.activeEnvironmentId).toBe("working");
    expect(failed.page.url).toBe("https://working.example");
    expect(failed.error).toBe("navigation_failed");
  });

  it("uses Chromium events as the authoritative address and history state", () => {
    const ready = browserControllerReducer(initialBrowserControllerState, {
      type: "sessionReady",
      page: page("https://first.example"),
      environmentId: "first",
    });
    const updated = browserControllerReducer(ready, {
      type: "pageChanged",
      page: {
        url: "https://first.example/inside",
        title: "Inside",
        loading: false,
        canGoBack: true,
        canGoForward: false,
        revision: 2,
      },
    });

    expect(updated.page.url).toBe("https://first.example/inside");
    expect(updated.page.canGoBack).toBe(true);
    expect(updated.page.canGoForward).toBe(false);
    expect(updated.activeEnvironmentId).toBeNull();
  });

  it("keeps the iframe as a terminal provider-free mode", () => {
    const fallback = browserControllerReducer(initialBrowserControllerState, {
      type: "iframeAvailable",
      reason: "fly_not_configured",
    });

    expect(fallback.phase).toBe("iframe");
    expect(fallback.fallbackReason).toBe("fly_not_configured");
    expect(fallback.error).toBeNull();
  });
});
