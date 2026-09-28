/**
 * Catalog + validation for the `show_view` spec contract: strict element
 * schemas, model-readable errors, and structural integrity checks.
 *
 * @testFramework vitest
 * @domain view-renderers
 */
import { describe, expect, it } from "vitest";
import { BUILTIN_VIEW_RENDERER_DEFINITIONS } from "@dashboard/lib/view-renderers/builtin";
import {
  buildChatViewCatalog,
  buildShowViewInputJsonSchema,
  componentNameForSlug,
} from "@dashboard/lib/view-renderers/spec/catalog";
import { validateChatViewSpec } from "@dashboard/lib/view-renderers/spec/validate";
import type { ViewRendererDefinition } from "@dashboard/lib/view-renderers/definition";

const catalog = buildChatViewCatalog([...BUILTIN_VIEW_RENDERER_DEFINITIONS]);

const validComposedSpec = {
  root: "card",
  elements: {
    card: { type: "Stack", props: {}, children: ["title", "buttons"] },
    title: {
      type: "Text",
      props: { value: "Publish the lesson?", variant: "title" },
    },
    buttons: { type: "Row", props: {}, children: ["ok", "no"] },
    ok: {
      type: "Button",
      props: { label: "Publish", response: "publish", variant: "primary" },
    },
    no: { type: "Button", props: { label: "Cancel", response: "cancel" } },
  },
};

describe("chat view catalog", () => {
  it("derives component names from slugs", () => {
    expect(componentNameForSlug("approval-card")).toBe("ApprovalCard");
    expect(componentNameForSlug("multi_select_list")).toBe("MultiSelectList");
  });

  it("suffixes definition slugs that collide with atom names", () => {
    const definition: ViewRendererDefinition = {
      slug: "text",
      name: "Text renderer",
      purpose: "text",
      type: "layout",
      data: { title: { type: "text" } },
      ui: { type: "text", value: "$title" },
    };
    const withCollision = buildChatViewCatalog([definition]);
    expect(withCollision.definitionComponents.has("TextView")).toBe(true);
    expect(withCollision.definitionComponents.get("Text")).toBeUndefined();
  });

  it("advertises the component enum in the tool JSON schema", () => {
    const schema = buildShowViewInputJsonSchema(catalog) as {
      properties: {
        elements: {
          items: { properties: { type: { enum: string[] } } };
        };
      };
    };
    const names =
      schema.properties.elements.items.properties.type.enum;
    expect(names).toContain("ApprovalCard");
    expect(names).toContain("Stack");
    expect(names).toContain("Button");
  });
});

describe("validateChatViewSpec", () => {
  it("accepts a composed atom spec", () => {
    const result = validateChatViewSpec(catalog, validComposedSpec);
    expect(result).toMatchObject({ success: true });
  });

  it("accepts a definition component with matching props", () => {
    const result = validateChatViewSpec(catalog, {
      root: "a",
      elements: {
        a: {
          type: "ApprovalCard",
          props: {
            title: "Create the lesson?",
            actions: [
              { label: "Approve", response: "approve", variant: "primary" },
              { label: "Cancel" },
            ],
          },
        },
      },
    });
    expect(result).toMatchObject({ success: true });
  });

  it("rejects unknown component types and names the valid ones", () => {
    const result = validateChatViewSpec(catalog, {
      root: "a",
      elements: { a: { type: "Zzz", props: {} } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('unknown type "Zzz"');
      expect(result.error).toContain("ApprovalCard");
    }
  });

  it("rejects wrong props with the element key and prop path", () => {
    const result = validateChatViewSpec(catalog, {
      root: "a",
      elements: {
        a: { type: "ApprovalCard", props: { heading: "typo key" } },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('element "a"');
      expect(result.error).toMatch(/title|heading/);
    }
  });

  it("collects issues across elements instead of stopping at the first", () => {
    const result = validateChatViewSpec(catalog, {
      root: "a",
      elements: {
        a: { type: "Stack", props: {}, children: ["b", "c"] },
        b: { type: "Zzz", props: {} },
        c: { type: "Text", props: {} },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('element "b"');
      expect(result.error).toContain('element "c"');
    }
  });

  it("rejects children that reference missing elements", () => {
    const result = validateChatViewSpec(catalog, {
      root: "a",
      elements: { a: { type: "Stack", props: {}, children: ["ghost"] } },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("ghost");
    }
  });

  it("recovers a single valid element when the supplied root is wrong", () => {
    const result = validateChatViewSpec(catalog, {
      root: "nope",
      elements: { a: { type: "Stack", props: {} } },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.spec.root).toBe("a");
  });

  it("coerces stringified props and numeric-keyed children (regression: MiniMax malformed elements)", () => {
    const result = validateChatViewSpec(catalog, {
      root: "card",
      elements: {
        card: {
          type: "Stack",
          props: "{}",
          children: { "0": "title", "1": "actions" },
        },
        title: {
          type: "Text",
          props: '{"value":"Approve?","variant":"title"}',
        },
        actions: { type: "Row", props: "{}", children: "ok" },
        ok: {
          type: "Button",
          props: { label: "Approve", response: "approve" },
        },
      },
    });
    expect(result).toMatchObject({ success: true });
    if (result.success) {
      expect(result.spec.elements.card.children).toEqual(["title", "actions"]);
      expect(result.spec.elements.title.props).toEqual({
        value: "Approve?",
        variant: "title",
      });
      expect(result.spec.elements.actions.children).toEqual(["ok"]);
    }
  });

  it("coerces props flattened onto the element", () => {
    const result = validateChatViewSpec(catalog, {
      root: "t",
      elements: {
        t: { type: "Text", value: "Hello", variant: "title" },
      },
    });
    expect(result).toMatchObject({ success: true });
    if (result.success) {
      expect(result.spec.elements.t.props).toEqual({
        value: "Hello",
        variant: "title",
      });
    }
  });

  it("coerces choice lists sent as objects or strings (regression: props.actions expected array, received object)", () => {
    const result = validateChatViewSpec(catalog, {
      root: "card",
      elements: {
        card: {
          type: "ApprovalCard",
          props: {
            title: "Write a short paragraph?",
            actions: {
              "0": { label: "Approve", response: "approve" },
              "1": "Cancel",
            },
          },
        },
      },
    });
    expect(result).toMatchObject({ success: true });
    if (result.success) {
      expect(result.spec.elements.card.props.actions).toEqual([
        { label: "Approve", response: "approve" },
        { label: "Cancel" },
      ]);
    }
  });

  it("coerces non-JSON string props and nested choice arrays (regression: random list turn)", () => {
    const result = validateChatViewSpec(catalog, {
      root: "card",
      elements: {
        card: {
          type: "Stack",
          props: "container",
          children: ["title", "list", "actions"],
        },
        title: { type: "Text", props: "Random items" },
        list: {
          type: "SelectionList",
          props: {
            title: "Pick one",
            items: [["Alpha", "Beta", "Gamma"]],
          },
        },
        actions: { type: "Row", props: "", children: ["ok"] },
        ok: { type: "Button", props: { label: "OK", response: "ok" } },
      },
    });
    expect(result).toMatchObject({ success: true });
    if (result.success) {
      expect(result.spec.elements.card.props).toEqual({});
      expect(result.spec.elements.title.props).toEqual({
        value: "Random items",
      });
      expect(result.spec.elements.list.props.items).toEqual([
        { label: "Alpha" },
        { label: "Beta" },
        { label: "Gamma" },
      ]);
    }
  });

  it("accepts a single top-level component without the envelope (weak-model shortcut)", () => {
    const result = validateChatViewSpec(catalog, {
      type: "MultiSelectList",
      props: {
        title: "Pick a few",
        items: [{ label: "Alpha" }, { label: "Beta" }],
      },
    });
    expect(result).toMatchObject({ success: true });
    if (result.success) {
      expect(result.spec.elements[result.spec.root]).toMatchObject({
        type: "MultiSelectList",
      });
    }
  });

  it("rejects non-spec input with envelope errors", () => {
    const result = validateChatViewSpec(catalog, {
      purpose: "approval-card",
      title: "old shape",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("root");
    }
  });
});
