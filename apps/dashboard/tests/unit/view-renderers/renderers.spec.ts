/**
 * @testFramework vitest
 * @domain view-renderers
 */
import { describe, expect, it } from "vitest";
import {
  buildRenderedViewDirective,
  normalizeViewRendererData,
  parseViewRendererDefinition,
  serializeViewRendererDefinition,
  type ViewRendererDefinition,
} from "@dashboard/lib/view-renderers/renderers";
import { parseViewRendererDefinitionInput } from "@dashboard/lib/view-renderers/definition";

describe("view renderer definitions", () => {
  const decisionRenderer: ViewRendererDefinition = {
    slug: "decision-card",
    name: "Decision card",
    purpose: "decision",
    aliases: ["approval"],
    rule: "Use this purpose when Kody presents a decision.",
    data: {
      title: { type: "text", description: "Short heading." },
      body: { type: "text", description: "Supporting text." },
      actions: {
        type: "actions",
        description: "Available responses.",
      },
    },
    defaults: {
      actions: [
        {
          id: "continue",
          label: "Continue",
          response: "continue",
          variant: "primary",
        },
      ],
    },
    type: "layout",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "$title", variant: "title" },
        { type: "text", value: "$body" },
        {
          type: "row",
          for: "$actions",
          as: "action",
          item: { type: "button", label: "$action.label", action: "$action" },
        },
      ],
    },
  };

  const choiceRenderer: ViewRendererDefinition = {
    slug: "choice-list",
    name: "Choice list",
    purpose: "choice",
    rule: "Use this purpose when Kody presents choices.",
    data: {
      title: {
        type: "text",
        description: "Short title.",
      },
      body: {
        type: "text",
        description: "Supporting text.",
      },
      items: {
        type: "selection",
        description: "Choices the user can select from.",
      },
    },
    type: "layout",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "$title", variant: "title" },
        { type: "text", value: "$body" },
        {
          type: "list",
          for: "$items",
          as: "item",
          item: { type: "button", label: "$item.label", action: "$item" },
        },
      ],
    },
  };

  it("parses a layout renderer", () => {
    const parsed = parseViewRendererDefinition(
      serializeViewRendererDefinition(decisionRenderer),
    );

    expect(parsed.slug).toBe("decision-card");
    expect(parsed.purpose).toBe("decision");
    expect(parsed.aliases).toEqual(["approval"]);
    expect(parsed.rule).toBeTruthy();
    expect(parsed.data?.title?.description).toBe("Short heading.");
    expect(parsed.defaults?.actions).toHaveLength(1);
    expect(parsed.type).toBe("layout");
    expect(parsed.ui.type).toBe("stack");
  });

  it("parses a selection renderer with generic UI atoms", () => {
    const parsed = parseViewRendererDefinition(
      serializeViewRendererDefinition(choiceRenderer),
    );

    expect(parsed.slug).toBe("choice-list");
    expect(parsed.purpose).toBe("choice");
    expect(parsed.ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text", value: "$title", variant: "title" },
        { type: "text", value: "$body" },
        { type: "list", for: "$items" },
      ],
    });
  });

  it("rejects renderer definitions without generic UI", () => {
    expect(() =>
      parseViewRendererDefinition(
        JSON.stringify({
          slug: "bad-renderer",
          name: "Bad renderer",
          purpose: "bad",
          type: "layout",
          data: { title: { type: "text" } },
        }),
      ),
    ).toThrow(/Invalid view renderer/);
  });

  it("rejects renderer definitions whose UI references undeclared data", () => {
    expect(() =>
      parseViewRendererDefinition(
        JSON.stringify({
          slug: "bad-renderer",
          name: "Bad renderer",
          purpose: "bad",
          type: "layout",
          data: { title: { type: "text" } },
          ui: {
            type: "stack",
            children: [
              { type: "text", value: "$title" },
              { type: "text", value: "$body" },
            ],
          },
        }),
      ),
    ).toThrow(/data key "body" is not declared/);
  });

  it("migrates legacy block renderers into generic UI definitions", () => {
    const parsed = parseViewRendererDefinitionInput(
      JSON.stringify({
        slug: "legacy-choice",
        name: "Legacy choice",
        purpose: "choice",
        rule: "Use this purpose when Kody presents choices.",
        type: "layout",
        blocks: [
          { type: "title", bind: "title" },
          { type: "text", bind: "body" },
          { type: "selection", bind: "items" },
        ],
      }),
    );

    expect(parsed.migrated).toBe(true);
    expect(parsed.definition.data).toMatchObject({
      title: { type: "text" },
      body: { type: "text" },
      items: { type: "selection" },
    });
    expect(parsed.definition.ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text", value: "$title", variant: "title" },
        { type: "text", value: "$body" },
        { type: "list", for: "$items" },
      ],
    });
    expect(serializeViewRendererDefinition(parsed.definition)).not.toContain(
      '"blocks"',
    );
  });

  it("builds a generic chat render directive", () => {
    const directive = buildRenderedViewDirective({
      id: "view-test",
      definition: decisionRenderer,
      data: {
        title: "Choose next step",
        body: "Pick one option before continuing.",
        actions: [
          {
            id: "continue",
            label: "Continue",
            response: "continue",
            variant: "primary",
          },
        ],
      },
    });

    expect(directive).toMatchObject({
      action: "render_view",
      view: "renderer",
      id: "view-test",
      rendererSlug: "decision-card",
      resultTarget: "chat",
    });
    expect(directive.ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text", value: "Choose next step", variant: "title" },
        { type: "text", value: "Pick one option before continuing." },
        {
          type: "row",
          children: [
            {
              type: "button",
              label: "Continue",
              action: { id: "continue", response: "continue" },
            },
          ],
        },
      ],
    });
    expect(directive.data.title).toBe("Choose next step");
  });

  it("adds a generic UI tree to rendered directives", () => {
    const directive = buildRenderedViewDirective({
      id: "view-test",
      definition: choiceRenderer,
      data: {
        title: "Choose one",
        body: "Pick one option.",
        items: ["Alpha", "Beta"],
      },
    });

    expect(directive.ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text", value: "Choose one", variant: "title" },
        { type: "text", value: "Pick one option." },
        {
          type: "list",
          children: [
            {
              type: "button",
              label: "Alpha",
              action: { id: "alpha", response: "alpha" },
            },
            {
              type: "button",
              label: "Beta",
              action: { id: "beta", response: "beta" },
            },
          ],
        },
      ],
    });
  });

  it("fills missing fields from renderer defaults", () => {
    const directive = buildRenderedViewDirective({
      id: "view-test",
      definition: decisionRenderer,
      data: {
        title: "Choose next step",
      },
    });

    expect(directive.data.actions).toEqual(decisionRenderer.defaults?.actions);
  });

  it("normalizes renderer data using field types, not renderer names", () => {
    const data = normalizeViewRendererData(choiceRenderer, {
      title: "Choose one",
      items: ["Alpha", "Beta"],
    });

    expect(data.items).toEqual([
      { id: "alpha", label: "Alpha", response: "alpha" },
      { id: "beta", label: "Beta", response: "beta" },
    ]);
  });

  it("normalizes selectable records from read/list tools", () => {
    const data = normalizeViewRendererData(choiceRenderer, {
      title: "Choose reports",
      items: [
        {
          slug: "cto",
          title: "CTO Report",
          updatedAt: "2026-07-04T12:00:00Z",
        },
        {
          slug: "security-audit",
          title: "Security Audit Status",
          path: "reports/security-audit.md",
        },
      ],
    });

    expect(data.items).toEqual([
      { id: "cto", label: "CTO Report", response: "cto" },
      {
        id: "security-audit",
        label: "Security Audit Status",
        response: "security-audit",
      },
    ]);
  });

  it("normalizes array-like tool data for list fields", () => {
    const data = normalizeViewRendererData(choiceRenderer, {
      title: "Choose one",
      items: {
        0: "op 1",
        1: "op2",
        2: "op 3",
      },
    });

    expect(data.items).toEqual([
      { id: "op-1", label: "op 1", response: "op-1" },
      { id: "op2", label: "op2", response: "op2" },
      { id: "op-3", label: "op 3", response: "op-3" },
    ]);
  });

  it("normalizes single-key tool wrappers for list fields", () => {
    const data = normalizeViewRendererData(choiceRenderer, {
      title: "Choose one",
      items: {
        anything: ["Alpha", "Beta"],
      },
    });

    expect(data.items).toEqual([
      { id: "alpha", label: "Alpha", response: "alpha" },
      { id: "beta", label: "Beta", response: "beta" },
    ]);
  });
  it("renders multi-select definitions as checkbox atoms, not choice buttons", () => {
    const multiSelectRenderer: ViewRendererDefinition = {
      slug: "multi-select-list",
      name: "Multi-select list",
      purpose: "multi-select-list",
      rule: "Use this purpose when Kody asks the user to choose multiple, several, a few, one or more, or zero or more items from a list.",
      type: "layout",
      data: {
        title: { type: "text" },
        items: { type: "selection" },
      },
      ui: {
        type: "stack",
        children: [
          { type: "text", value: "$title", variant: "title" },
          {
            type: "list",
            for: "$items",
            as: "item",
            item: {
              type: "checkbox",
              name: "selected",
              value: "$item.id",
              label: "$item.label",
            },
          },
          { type: "submit", label: "Confirm" },
        ],
      },
    };

    const directive = buildRenderedViewDirective({
      id: "view-multi-select-regression",
      definition: multiSelectRenderer,
      data: {
        title: "Choose one or more reports",
        items: [
          { slug: "cto", title: "CTO Report" },
          { slug: "security-audit", title: "Security Audit" },
        ],
      },
    });

    expect(directive.ui).toMatchObject({
      type: "stack",
      children: [
        { type: "text", value: "Choose one or more reports" },
        {
          type: "list",
          children: [
            { type: "checkbox", value: "cto", label: "CTO Report" },
            {
              type: "checkbox",
              value: "security-audit",
              label: "Security Audit",
            },
          ],
        },
        { type: "submit", label: "Confirm" },
      ],
    });
  });
});
