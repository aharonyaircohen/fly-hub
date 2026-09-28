import { describe, expect, it, vi } from "vitest";

import {
  actInRemotePreview,
  formatRemoteSnapshotOutline,
} from "@dashboard/lib/picker/useRemoteElementPicker";

describe("actInRemotePreview", () => {
  it("preserves Capability scope and returns the fresh Fly snapshot", async () => {
    const remoteAct = vi.fn(async () => ({
      ok: true,
      url: "https://www.facebook.com/",
      title: "Facebook",
      data: {
        snapshot: {
          text: "Create post",
          elements: [{ selector: "#composer", name: "Create post" }],
        },
      },
    }));

    const result = await actInRemotePreview(remoteAct, {
      op: "click",
      selector: "#composer",
      capabilitySlug: "draft-facebook-personal-post",
      allowedOrigins: ["https://www.facebook.com"],
    });

    expect(remoteAct).toHaveBeenCalledWith({
      type: "click",
      selector: "#composer",
      capabilitySlug: "draft-facebook-personal-post",
      allowedOrigins: ["https://www.facebook.com"],
    });
    expect(result).toEqual({
      ok: true,
      error: undefined,
      info: {
        url: "https://www.facebook.com/",
        title: "Facebook",
        selection: "",
        dom: [
          "Interactive controls:",
          '- control "Create post" — selector: #composer',
          "",
          "Visible text:",
          "Create post",
        ].join("\n"),
      },
    });
  });

  it("puts useful controls before long page text", () => {
    const outline = formatRemoteSnapshotOutline({
      text: "feed ".repeat(2_000),
      elements: [
        {
          ref: "e1",
          selector: "#hidden",
          role: "button",
          name: "Hidden",
          disabled: false,
          box: { x: 0, y: 0, width: 0, height: 0 },
        },
        {
          ref: "e2",
          selector: "#composer",
          role: "button",
          name: "What's on your mind, Aharon?",
          disabled: false,
          box: { x: 10, y: 10, width: 300, height: 40 },
        },
      ],
    });

    expect(outline.indexOf("#composer")).toBeLessThan(
      outline.indexOf("Visible text:"),
    );
    expect(outline).not.toContain("#hidden");
    expect(outline.length).toBeLessThanOrEqual(4_000);
  });

  it("maps scoped scrolling onto the existing browser-session action", async () => {
    const remoteAct = vi.fn(async () => ({ ok: true }));

    await actInRemotePreview(remoteAct, {
      op: "scroll",
      dy: 420,
      capabilitySlug: "draft-facebook-personal-post",
      allowedOrigins: ["https://www.facebook.com"],
    });

    expect(remoteAct).toHaveBeenCalledWith({
      type: "scroll",
      selector: undefined,
      deltaY: 420,
      capabilitySlug: "draft-facebook-personal-post",
      allowedOrigins: ["https://www.facebook.com"],
    });
  });
});
