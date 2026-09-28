/**
 * Expansion of validated `show_view` specs into the RenderedViewDirective
 * wire format the client already renders.
 *
 * @testFramework vitest
 * @domain view-renderers
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_VIEW_RENDERER_DEFINITIONS } from "../../../src/dashboard/lib/view-renderers/builtin";
import { buildChatViewCatalog } from "../../../src/dashboard/lib/view-renderers/spec/catalog";
import {
  buildChatViewDirective,
  expandChatViewSpec,
} from "../../../src/dashboard/lib/view-renderers/spec/expand";
import { validateChatViewSpec } from "../../../src/dashboard/lib/view-renderers/spec/validate";
import { isRenderedViewDirective } from "../../../src/dashboard/lib/chat-ui-actions";

const catalog = buildChatViewCatalog([...BUILTIN_VIEW_RENDERER_DEFINITIONS]);

function validSpec(input: unknown) {
  const result = validateChatViewSpec(catalog, input);
  if (!result.success) throw new Error(result.error);
  return result.spec;
}

describe("expandChatViewSpec", () => {
  it("expands composed atoms into the wire ui tree", () => {
    const ui = expandChatViewSpec(
      catalog,
      validSpec({
        root: "card",
        elements: {
          card: { type: "Stack", props: {}, children: ["t", "row"] },
          t: { type: "Text", props: { value: "Pick", variant: "title" } },
          row: { type: "Row", props: {}, children: ["a"] },
          a: {
            type: "Button",
            props: { label: "Alpha", response: "alpha", variant: "primary" },
          },
        },
      }),
    );
    expect(ui).toEqual({
      type: "stack",
      children: [
        { type: "text", value: "Pick", variant: "title" },
        {
          type: "row",
          children: [
            {
              type: "button",
              label: "Alpha",
              action: {
                id: "alpha",
                label: "Alpha",
                response: "alpha",
                variant: "primary",
              },
            },
          ],
        },
      ],
    });
  });

  it("expands a definition component through its brand template with defaults", () => {
    const ui = expandChatViewSpec(
      catalog,
      validSpec({
        root: "a",
        elements: {
          a: {
            type: "ApprovalCard",
            props: { title: "Create the record?" },
          },
        },
      }),
    );
    expect(ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text", value: "Create the record?", variant: "title" },
        { type: "markdown", value: "" },
        {
          type: "row",
          children: [
            { type: "button", label: "Approve" },
            { type: "button", label: "Cancel" },
          ],
        },
      ],
    });
  });

  it("normalizes choice props for definition list fields", () => {
    const ui = expandChatViewSpec(
      catalog,
      validSpec({
        root: "a",
        elements: {
          a: {
            type: "SelectionList",
            props: {
              title: "Pick one",
              items: [{ label: "Alpha" }, { label: "Beta", response: "b" }],
            },
          },
        },
      }),
    );
    expect(ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text", value: "Pick one", variant: "title" },
        { type: "markdown", value: "" },
        {
          type: "list",
          children: [
            { type: "button", label: "Alpha", action: { response: "Alpha" } },
            { type: "button", label: "Beta", action: { response: "b" } },
          ],
        },
      ],
    });
  });

  it("expands checkbox forms with submit", () => {
    const ui = expandChatViewSpec(
      catalog,
      validSpec({
        root: "form",
        elements: {
          form: { type: "Stack", props: {}, children: ["c1", "go"] },
          c1: {
            type: "Checkbox",
            props: { name: "selected", value: "cto", label: "CTO Report" },
          },
          go: { type: "Submit", props: { label: "Confirm" } },
        },
      }),
    );
    expect(ui).toEqual({
      type: "stack",
      children: [
        {
          type: "checkbox",
          name: "selected",
          value: "cto",
          label: "CTO Report",
        },
        { type: "submit", label: "Confirm" },
      ],
    });
  });
});

describe("buildChatViewDirective", () => {
  it("builds a wire-valid directive with the root definition identity", () => {
    const directive = buildChatViewDirective({
      id: "view-1",
      catalog,
      spec: validSpec({
        root: "a",
        elements: {
          a: { type: "ApprovalCard", props: { title: "Continue?" } },
        },
      }),
    });
    expect(directive).toMatchObject({
      action: "render_view",
      view: "renderer",
      id: "view-1",
      rendererSlug: "approval-card",
      rendererName: "Approval card",
      resultTarget: "chat",
    });
    expect(isRenderedViewDirective(directive)).toBe(true);
  });

  it("labels composed specs with the composed-view identity", () => {
    const directive = buildChatViewDirective({
      id: "view-2",
      catalog,
      spec: validSpec({
        root: "t",
        elements: { t: { type: "Text", props: { value: "hi" } } },
      }),
    });
    expect(directive.rendererSlug).toBe("composed-view");
    expect(isRenderedViewDirective(directive)).toBe(true);
  });
});
