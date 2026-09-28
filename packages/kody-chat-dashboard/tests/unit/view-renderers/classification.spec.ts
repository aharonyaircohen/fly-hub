import { describe, expect, it } from "vitest";
import { parseViewRendererDefinition } from "../../../src/dashboard/lib/view-renderers/definition";
import { isWidgetViewRenderer } from "../../../src/dashboard/lib/view-renderers/classification";

describe("view renderer classification", () => {
  it("recognizes a widget nested inside a renderer layout", () => {
    const renderer = parseViewRendererDefinition(
      JSON.stringify({
        slug: "question-select",
        name: "Question select",
        type: "layout",
        ui: {
          type: "stack",
          children: [
            { type: "text", value: "Question" },
            { type: "widget", widget: "question-select" },
          ],
        },
      }),
    );

    expect(isWidgetViewRenderer(renderer)).toBe(true);
  });

  it("keeps ordinary renderers out of the widget choice", () => {
    const renderer = parseViewRendererDefinition(
      JSON.stringify({
        slug: "approval-card",
        name: "Approval card",
        type: "layout",
        ui: { type: "text", value: "Approve" },
      }),
    );

    expect(isWidgetViewRenderer(renderer)).toBe(false);
  });
});
