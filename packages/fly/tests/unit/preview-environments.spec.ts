import { describe, expect, it } from "vitest";

import {
  addEnvironment,
  type PreviewEnvironment,
} from "../../src/preview-environments";

describe("addEnvironment", () => {
  it("assigns a unique saved-view label without replacing an existing view", () => {
    const existing: PreviewEnvironment[] = [
      { id: "docs", label: "example.com docs", url: "https://other.test" },
      {
        id: "docs-2",
        label: "example.com docs 2",
        url: "https://another.test",
      },
    ];

    const next = addEnvironment(
      existing,
      "example.com docs",
      "https://example.com/docs",
    );

    expect(next).toHaveLength(3);
    expect(next.slice(0, 2)).toEqual(existing);
    expect(next[2]).toMatchObject({
      label: "example.com docs 3",
      url: "https://example.com/docs",
    });
  });
});
