/**
 * Widget view node: renderer-definition schema acceptance, `$ref` data
 * resolution through the UI template, and rendered-view directive
 * validation for the new `widget` UI node.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import {
  parseViewRendererDefinition,
  type ViewRendererDefinition,
} from "../../../src/dashboard/lib/view-renderers/definition";
import { resolveViewRendererUi } from "../../../src/dashboard/lib/view-renderers/template";
import { isRenderedViewDirective } from "../../../src/dashboard/lib/chat-ui-actions";

function definitionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    slug: "record-widget",
    name: "Record widget",
    type: "layout",
    data: { record: { type: "value" } },
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "Record", variant: "title" },
        { type: "widget", widget: "quiz", data: "$record" },
      ],
    },
    ...overrides,
  });
}

describe("widget renderer-definition node", () => {
  it("parses a definition whose UI embeds a widget node", () => {
    const definition = parseViewRendererDefinition(definitionJson());
    expect(definition.ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text" },
        { type: "widget", widget: "quiz", data: "$record" },
      ],
    });
  });

  it("rejects widget slugs that break the slug contract", () => {
    expect(() =>
      parseViewRendererDefinition(
        definitionJson({
          ui: { type: "widget", widget: "Not A Slug" },
        }),
      ),
    ).toThrow(/Invalid view renderer/);
  });

  it("rejects a widget data $ref to an undeclared data key", () => {
    expect(() =>
      parseViewRendererDefinition(
        definitionJson({
          data: {},
          ui: { type: "widget", widget: "quiz", data: "$record" },
        }),
      ),
    ).toThrow(/data key "record" is not declared/);
  });

  it("allows inline (non-string) widget data without declared keys", () => {
    const definition = parseViewRendererDefinition(
      definitionJson({
        data: {},
        ui: { type: "widget", widget: "quiz", data: { fixed: true } },
      }),
    );
    expect(definition.ui).toEqual({
      type: "widget",
      widget: "quiz",
      data: { fixed: true },
    });
  });
});

describe("widget template resolution", () => {
  function resolve(data: Record<string, unknown>) {
    const definition = parseViewRendererDefinition(
      definitionJson(),
    ) as ViewRendererDefinition;
    return resolveViewRendererUi(definition, data);
  }

  it("resolves a $ref data binding to the caller's value", () => {
    const { ui } = resolve({ record: "verbs-101" });
    expect(ui).toMatchObject({
      children: [
        { type: "text", value: "Record" },
        { type: "widget", widget: "quiz", data: "verbs-101" },
      ],
    });
  });

  it("omits data when the $ref resolves to nothing", () => {
    const { ui } = resolve({});
    if (ui.type !== "stack") throw new Error("expected a stack root");
    const widgetNode = ui.children.find((node) => node.type === "widget");
    expect(widgetNode).toEqual({ type: "widget", widget: "quiz" });
  });

  it("passes inline widget data through untouched", () => {
    const definition = parseViewRendererDefinition(
      definitionJson({
        data: {},
        ui: {
          type: "widget",
          widget: "quiz",
          data: { questions: [1, 2, 3] },
        },
      }),
    );
    const { ui } = resolveViewRendererUi(definition, {});
    expect(ui).toEqual({
      type: "widget",
      widget: "quiz",
      data: { questions: [1, 2, 3] },
    });
  });
});

describe("rendered-view directive with a widget node", () => {
  function directive(ui: unknown): Record<string, unknown> {
    return {
      action: "render_view",
      view: "renderer",
      id: "view-1",
      rendererSlug: "record-widget",
      rendererName: "Record widget",
      resultTarget: "chat",
      ui,
      data: {},
    };
  }

  it("accepts a widget UI node (with or without data)", () => {
    expect(
      isRenderedViewDirective(
        directive({ type: "widget", widget: "quiz", data: { a: 1 } }),
      ),
    ).toBe(true);
    expect(
      isRenderedViewDirective(directive({ type: "widget", widget: "quiz" })),
    ).toBe(true);
    expect(
      isRenderedViewDirective(
        directive({
          type: "stack",
          children: [{ type: "widget", widget: "quiz" }],
        }),
      ),
    ).toBe(true);
  });

  it("rejects a widget node without a slug", () => {
    expect(isRenderedViewDirective(directive({ type: "widget" }))).toBe(false);
    expect(
      isRenderedViewDirective(directive({ type: "widget", widget: "" })),
    ).toBe(false);
  });
});
