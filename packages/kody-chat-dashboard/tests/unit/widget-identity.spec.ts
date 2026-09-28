import { describe, expect, it } from "vitest";
import {
  widgetNameFromSlug,
  widgetSlugFromName,
} from "../../src/dashboard/lib/widgets/identity";

describe("widget identity", () => {
  it("derives a stable slug from a human-readable name", () => {
    expect(widgetSlugFromName("Question Select")).toBe("question-select");
  });

  it("provides a readable name for legacy slug-only widgets", () => {
    expect(widgetNameFromSlug("question-select")).toBe("Question Select");
  });
});
