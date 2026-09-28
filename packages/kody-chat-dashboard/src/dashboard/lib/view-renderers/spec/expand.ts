/**
 * @fileType util
 * @domain view-renderers
 * @pattern spec-expansion
 * @ai-summary Expands a validated `show_view` spec into the existing
 *   RenderedViewDirective wire format: atoms map one-to-one onto
 *   RenderedViewUiNode, and high-level definition components resolve
 *   through their brand UI template. The client renderer is unchanged.
 */
import {
  RENDER_VIEW_DIRECTIVE,
  type RenderedViewDirective,
  type RenderedViewUiNode,
} from "../../chat-ui-actions";
import type { ViewRendererDefinition } from "../definition";
import { actionIdFromLabel, resolveViewRendererUi } from "../template";
import type { ChatViewCatalog, ChatViewSpecElement } from "./catalog";
import type { ChatViewSpec } from "./validate";

const CONTAINER_TYPES: Record<string, "stack" | "row" | "list"> = {
  Stack: "stack",
  Row: "row",
  List: "list",
};

/** Fallback identity for specs whose root is composed from atoms. */
export const COMPOSED_VIEW_SLUG = "composed-view";
export const COMPOSED_VIEW_NAME = "Composed view";

export function buildChatViewDirective({
  id,
  catalog,
  spec,
}: {
  id: string;
  catalog: ChatViewCatalog;
  spec: ChatViewSpec;
}): RenderedViewDirective {
  const rootDefinition = catalog.definitionComponents.get(
    spec.elements[spec.root]?.type ?? "",
  );
  return {
    action: RENDER_VIEW_DIRECTIVE,
    view: "renderer",
    id,
    rendererSlug: rootDefinition?.slug ?? COMPOSED_VIEW_SLUG,
    rendererName: rootDefinition?.name ?? COMPOSED_VIEW_NAME,
    resultTarget: "chat",
    ui: expandChatViewSpec(catalog, spec),
    data: {},
  };
}

export function expandChatViewSpec(
  catalog: ChatViewCatalog,
  spec: ChatViewSpec,
): RenderedViewUiNode {
  return expandElement(catalog, spec, spec.root, new Set());
}

function specElement(spec: ChatViewSpec, key: string): ChatViewSpecElement {
  const element = spec.elements[key];
  if (!element) {
    throw new Error(`Spec element "${key}" not found`);
  }
  return {
    type: element.type,
    props: element.props ?? {},
    children: element.children ?? [],
  };
}

function expandElement(
  catalog: ChatViewCatalog,
  spec: ChatViewSpec,
  key: string,
  visiting: ReadonlySet<string>,
): RenderedViewUiNode {
  if (visiting.has(key)) {
    throw new Error(`Spec element "${key}" is part of a cycle`);
  }
  const element = specElement(spec, key);
  const definition = catalog.definitionComponents.get(element.type);
  if (definition) {
    return expandDefinitionElement(definition, element);
  }
  const container = CONTAINER_TYPES[element.type];
  if (container) {
    const nextVisiting = new Set(visiting).add(key);
    return {
      type: container,
      children: (element.children ?? []).map((childKey) =>
        expandElement(catalog, spec, childKey, nextVisiting),
      ),
    };
  }
  return expandAtomLeaf(element);
}

/**
 * A definition component is a leaf: its props are the renderer data, and
 * its brand template produces the subtree. Declared children are ignored.
 */
function expandDefinitionElement(
  definition: ViewRendererDefinition,
  element: ChatViewSpecElement,
): RenderedViewUiNode {
  return resolveViewRendererUi(definition, element.props).ui;
}

function stringProp(element: ChatViewSpecElement, key: string): string {
  const value = element.props[key];
  return typeof value === "string" ? value : "";
}

function optionalStringProp(
  element: ChatViewSpecElement,
  key: string,
): string | undefined {
  const value = element.props[key];
  return typeof value === "string" && value ? value : undefined;
}

function expandAtomLeaf(element: ChatViewSpecElement): RenderedViewUiNode {
  switch (element.type) {
    case "Text": {
      const variant = optionalStringProp(element, "variant");
      return {
        type: "text",
        value: stringProp(element, "value"),
        ...(variant === "title" || variant === "body" || variant === "label"
          ? { variant }
          : {}),
      };
    }
    case "Markdown":
      return { type: "markdown", value: stringProp(element, "value") };
    case "Input": {
      const label = optionalStringProp(element, "label");
      return {
        type: "input",
        value: stringProp(element, "value"),
        ...(label ? { label } : {}),
        readOnly: true,
      };
    }
    case "Button": {
      const label = stringProp(element, "label");
      const response = stringProp(element, "response") || label;
      const variant = optionalStringProp(element, "variant");
      return {
        type: "button",
        label,
        action: {
          id: actionIdFromLabel(response),
          label,
          response,
          ...(variant === "primary" ||
          variant === "secondary" ||
          variant === "danger"
            ? { variant }
            : {}),
        },
      };
    }
    case "Checkbox":
      return {
        type: "checkbox",
        name: stringProp(element, "name"),
        value: stringProp(element, "value"),
        label: stringProp(element, "label"),
      };
    case "Submit":
      return { type: "submit", label: stringProp(element, "label") };
    default:
      throw new Error(`Unknown spec element type "${element.type}"`);
  }
}
