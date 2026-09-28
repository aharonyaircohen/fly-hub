import { describe, expect, it, vi } from "vitest";

import {
  consumePendingViewsCapabilityAction,
  ensureViewsOwnedCapabilityAction,
  isSelectedViewPath,
  isViewsPath,
  stagePendingViewsCapabilityAction,
} from "../../src/dashboard/lib/picker/views-owned-preview-action";
import type { PreviewActDirective } from "../../src/dashboard/lib/chat-ui-actions";
import type { PreviewAction } from "../../src/dashboard/lib/picker/protocol";

const capabilityAction: PreviewAction = {
  op: "navigate",
  url: "https://www.facebook.com/",
  capabilitySlug: "draft-facebook-personal-post",
  allowedOrigins: ["https://www.facebook.com"],
};

describe("Views-owned Capability browser actions", () => {
  it("carries a Capability action across a full route reload exactly once", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const directive: PreviewActDirective = {
      action: "preview_act",
      op: "navigate",
      url: "https://www.facebook.com/",
      capabilitySlug: "draft-facebook-personal-post",
      allowedOrigins: ["https://www.facebook.com"],
      reason: "Open Facebook",
    };

    stagePendingViewsCapabilityAction(directive, storage, 1_000);

    expect(consumePendingViewsCapabilityAction(storage, 1_500)).toEqual(
      directive,
    );
    expect(consumePendingViewsCapabilityAction(storage, 1_500)).toBeNull();
  });

  it("drops stale persisted browser actions instead of replaying them", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const directive: PreviewActDirective = {
      action: "preview_act",
      op: "wait",
      ms: 100,
      capabilitySlug: "draft-facebook-personal-post",
      reason: "Wait",
    };

    stagePendingViewsCapabilityAction(directive, storage, 1_000);

    expect(consumePendingViewsCapabilityAction(storage, 122_001)).toBeNull();
  });

  it("recognizes canonical repository-scoped Views routes", () => {
    expect(isViewsPath("/repo/acme/project/preview")).toBe(true);
    expect(isViewsPath("/repo/acme/project/preview/facebook")).toBe(true);
    expect(isViewsPath("/repo/acme/project/file-spaces/content-studio")).toBe(
      false,
    );
  });

  it("distinguishes the Views chooser from an active saved View", () => {
    expect(isSelectedViewPath("/repo/acme/project/preview")).toBe(false);
    expect(isSelectedViewPath("/repo/acme/project/preview/facebook")).toBe(
      true,
    );
  });

  it("opens Views and waits for its remote browser before acting", async () => {
    let available = false;
    const openViews = vi.fn(() => {
      available = true;
    });

    await expect(
      ensureViewsOwnedCapabilityAction({
        action: capabilityAction,
        pathname: "/repo/acme/project/file-spaces/content-studio/post.md",
        openViews,
        remoteBrowserAvailable: () => available,
        wait: async () => {},
      }),
    ).resolves.toBe(true);

    expect(openViews).toHaveBeenCalledOnce();
  });

  it("never sends a Capability action to the preview extension fallback", async () => {
    const openViews = vi.fn();

    await expect(
      ensureViewsOwnedCapabilityAction({
        action: capabilityAction,
        pathname: "/repo/acme/project/preview/facebook",
        openViews,
        remoteBrowserAvailable: () => false,
        wait: async () => {},
        maxAttempts: 2,
      }),
    ).resolves.toBe(false);

    expect(openViews).not.toHaveBeenCalled();
  });

  it("allows a normal Fly cold start before reporting the browser unavailable", async () => {
    let waits = 0;

    await expect(
      ensureViewsOwnedCapabilityAction({
        action: capabilityAction,
        pathname: "/repo/acme/project/preview",
        openViews: vi.fn(),
        remoteBrowserAvailable: () => waits === 120,
        wait: async () => {
          waits += 1;
        },
      }),
    ).resolves.toBe(true);
  });

  it("leaves ordinary preview actions on their existing surface", async () => {
    const openViews = vi.fn();

    await expect(
      ensureViewsOwnedCapabilityAction({
        action: { op: "click", selector: "#save" },
        pathname: "/repo/acme/project/tasks/1/preview",
        openViews,
        remoteBrowserAvailable: () => false,
        wait: async () => {},
      }),
    ).resolves.toBe(true);

    expect(openViews).not.toHaveBeenCalled();
  });
});
