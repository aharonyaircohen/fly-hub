import { describe, expect, it } from "vitest";

import { messageJustifyClass } from "@kody-ade/kody-chat-dashboard/surface/MessageList";

describe("message list role layout", () => {
  it("keeps dashboard chat user-right and assistant-left", () => {
    expect(messageJustifyClass("user", "dashboard")).toBe("justify-end");
    expect(messageJustifyClass("assistant", "dashboard")).toBe(
      "justify-start",
    );
  });

  it("uses client support chat visitor-left and brand-agent-right", () => {
    expect(messageJustifyClass("user", "client")).toBe("justify-start");
    expect(messageJustifyClass("assistant", "client")).toBe("justify-end");
  });
});
