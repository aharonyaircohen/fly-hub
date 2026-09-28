import { describe, expect, it } from "vitest";
import {
  isReadOnlyViewInput,
  isViewInputDisabled,
  replaceFirstRenderedViewList,
} from "../../../src/dashboard/lib/chat/surface/RenderedViewCard";

describe("RenderedViewCard input ownership", () => {
  it("treats unspecified inputs as display-only", () => {
    expect(isReadOnlyViewInput({ type: "input", value: "repo" })).toBe(true);
  });

  it("keeps explicitly editable inputs as controls", () => {
    expect(
      isReadOnlyViewInput({ type: "input", value: "repo", readOnly: false }),
    ).toBe(false);
  });

  it("disables editable fields when their view card is inactive", () => {
    expect(isViewInputDisabled(true)).toBe(true);
    expect(isViewInputDisabled(false)).toBe(false);
  });
});

describe("RenderedViewCard dynamic selection", () => {
  it("replaces the renderer's empty list with CMS-backed actions", () => {
    expect(
      replaceFirstRenderedViewList(
        {
          type: "stack",
          children: [
            { type: "text", value: "Choose an item" },
            { type: "list", children: [] },
          ],
        },
        [
          {
            id: "continue",
            label: "Example item",
            response: "Example item",
            result: { recordId: "record-1" },
          },
        ],
      ),
    ).toEqual({
      type: "stack",
      children: [
        { type: "text", value: "Choose an item" },
        {
          type: "list",
          children: [
            {
              type: "button",
              label: "Example item",
              action: {
                id: "continue",
                label: "Example item",
                response: "Example item",
                result: { recordId: "record-1" },
              },
            },
          ],
        },
      ],
    });
  });
});
