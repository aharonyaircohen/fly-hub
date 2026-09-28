import { describe, expect, it } from "vitest";
import { runtimeAppName } from "../../builder/src/app-builder-names";

describe("runtimeAppName", () => {
  it("keeps the identifying suffix while staying within Fly's name limit", () => {
    const gateway = "kody-app-aharonyaircohen-kody-chat-open-notebook-c4f35360";
    const runtime = runtimeAppName(gateway);

    expect(runtime.length).toBeLessThanOrEqual(63);
    expect(runtime).toMatch(/-rt-c4f35360$/);
    expect(runtime).not.toBe(gateway);
  });
});
