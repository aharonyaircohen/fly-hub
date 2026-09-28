import { describe, expect, it } from "vitest";

import { hasSecretMetadata } from "../../src/dashboard/lib/components/kody-chat-data";

describe("chat data secret metadata", () => {
  it("detects a configured secret without reading its value", () => {
    expect(
      hasSecretMetadata(
        {
          secrets: [{ name: "MINIMAX_API_KEY" }, { name: "FLY_API_TOKEN" }],
        },
        "FLY_API_TOKEN",
      ),
    ).toBe(true);
  });

  it("treats absent or malformed metadata as not configured", () => {
    expect(hasSecretMetadata({ secrets: [] }, "FLY_API_TOKEN")).toBe(false);
    expect(hasSecretMetadata({}, "FLY_API_TOKEN")).toBe(false);
  });
});
