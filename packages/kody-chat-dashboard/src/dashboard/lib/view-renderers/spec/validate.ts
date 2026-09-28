/**
 * @fileType util
 * @domain view-renderers
 * @pattern spec-validation
 * @ai-summary Strict validation of a `show_view` spec against the catalog.
 *   Errors are returned as one model-readable message (element key + prop
 *   path + expectation) so the model can correct and retry — replacing the
 *   old repair path that fabricated data from prose.
 */
import { z } from "zod";
import { validateSpec, type Spec } from "@json-render/core";
import type { ChatViewCatalog } from "./catalog";

export type ChatViewSpec = Spec;

export type ChatViewSpecValidation =
  | { success: true; spec: ChatViewSpec }
  | { success: false; error: string };

const SPEC_ENVELOPE_SCHEMA = z.object({
  root: z.string().trim().min(1).max(64),
  elements: z
    .record(z.string().trim().min(1).max(64), z.unknown())
    .refine((elements) => Object.keys(elements).length > 0, {
      message: "elements must not be empty",
    })
    .refine((elements) => Object.keys(elements).length <= 100, {
      message: "elements must have at most 100 entries",
    }),
});

function formatZodIssues(prefix: string, error: z.ZodError): string[] {
  return error.issues
    .slice(0, 8)
    .map((issue) =>
      [prefix, issue.path.join("."), issue.message]
        .filter(Boolean)
        .join(": "),
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const ELEMENT_ENVELOPE_KEYS = new Set(["type", "props", "children"]);

/**
 * Normalize the two generic layout names models most commonly substitute for
 * the renderer's exact atoms. The mapping is semantic and provider-agnostic:
 * Container is a Stack/Row, while Heading is titled Text.
 */
function coerceCommonComponentAlias(
  element: Record<string, unknown>,
): Record<string, unknown> {
  if (element.type === "Container") {
    const props = isRecord(element.props) ? element.props : {};
    element = {
      ...element,
      type: props.direction === "row" ? "Row" : "Stack",
    };
  }
  if (element.type === "Heading") {
    const props = isRecord(element.props) ? element.props : {};
    const value =
      typeof element.props === "string"
        ? element.props
        : [props.value, props.text, props.title].find(
            (candidate): candidate is string => typeof candidate === "string",
          );
    return {
      ...element,
      type: "Text",
      props: { value, variant: "title" },
    };
  }
  if (
    element.type === "Stack" ||
    element.type === "Row" ||
    element.type === "List"
  ) {
    return { ...element, props: {} };
  }
  return element;
}

/**
 * Repair common model malformations BEFORE strict validation, all observed
 * in real turns: props sent as a JSON string, children sent as a
 * numeric-keyed object or a single string, and props flattened onto the
 * element instead of nested. Anything else still fails validation with a
 * precise error the model can act on.
 */
export function coerceSpecElementShape(
  catalog: ChatViewCatalog,
  raw: unknown,
): unknown {
  if (!isRecord(raw)) return raw;
  let element = { ...raw };
  if (typeof element.props === "string") {
    try {
      const parsed: unknown = JSON.parse(element.props);
      if (isRecord(parsed)) element.props = parsed;
    } catch {
      // Not JSON — salvage below.
    }
  }
  if (element.props === undefined || element.props === null) {
    const flattened = Object.entries(element).filter(
      ([key]) => !ELEMENT_ENVELOPE_KEYS.has(key),
    );
    element.props = Object.fromEntries(flattened);
    for (const [key] of flattened) delete element[key];
  }
  element = coerceCommonComponentAlias(element);
  if (typeof element.props === "string" && typeof element.type === "string") {
    // Bare-string props: map to the component's main text prop, or drop
    // for prop-less containers.
    const primary = catalog.primaryTextProps.get(element.type);
    element.props = primary ? { [primary]: element.props } : {};
  }
  if (typeof element.children === "string") {
    element.children = [element.children];
  } else if (isRecord(element.children)) {
    element.children = Object.values(element.children).filter(
      (child): child is string => typeof child === "string",
    );
  }
  return element;
}

function unknownTypeMessage(
  catalog: ChatViewCatalog,
  key: string,
  type: unknown,
): string {
  return `element "${key}": unknown type ${JSON.stringify(type)}. Valid types: ${catalog.componentNames.join(", ")}`;
}

/**
 * Validate a raw `show_view` input. Element-level issues are collected per
 * element key so one bad element doesn't hide the others.
 */
/**
 * Accept a bare component element as the whole spec — the shortcut weak
 * models reach for. `{type: "MultiSelectList", props: {...}}` becomes
 * `{root: "root", elements: {root: <element>}}`.
 */
function coerceSpecEnvelope(input: unknown): unknown {
  if (!isRecord(input)) return input;
  if (Array.isArray(input.elements)) {
    const keyedElements = input.elements.map((rawElement) => {
      if (!isRecord(rawElement)) return null;
      const { key, ...element } = rawElement;
      return typeof key === "string" && key.trim()
        ? ([key.trim(), element] as const)
        : null;
    });
    const keys = keyedElements.flatMap((entry) => (entry ? [entry[0]] : []));
    if (
      keyedElements.every((entry) => entry !== null) &&
      new Set(keys).size === keyedElements.length
    ) {
      return { ...input, elements: Object.fromEntries(keyedElements) };
    }
  }
  if (input.root !== undefined || input.elements !== undefined) return input;
  const type = input.type ?? input.component;
  if (typeof type !== "string") return input;
  return { root: "root", elements: { root: { ...input, type } } };
}

export function validateChatViewSpec(
  catalog: ChatViewCatalog,
  input: unknown,
): ChatViewSpecValidation {
  const envelope = SPEC_ENVELOPE_SCHEMA.safeParse(coerceSpecEnvelope(input));
  if (!envelope.success) {
    return {
      success: false,
      error: formatZodIssues("spec", envelope.error).join("; "),
    };
  }
  const issues: string[] = [];
  const elements: Record<string, ChatViewSpec["elements"][string]> = {};
  for (const [key, rawInput] of Object.entries(envelope.data.elements)) {
    const raw = coerceSpecElementShape(catalog, rawInput);
    const type =
      raw && typeof raw === "object"
        ? (raw as { type?: unknown }).type
        : undefined;
    const schema =
      typeof type === "string" ? catalog.elementSchemas.get(type) : undefined;
    if (!schema) {
      issues.push(unknownTypeMessage(catalog, key, type));
      continue;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      issues.push(...formatZodIssues(`element "${key}"`, parsed.error));
      continue;
    }
    elements[key] = {
      type: parsed.data.type,
      props: parsed.data.props,
      children: parsed.data.children ?? [],
    };
  }
  if (issues.length > 0) {
    return { success: false, error: issues.join("; ") };
  }
  const root = Object.prototype.hasOwnProperty.call(elements, envelope.data.root)
    ? envelope.data.root
    : Object.keys(elements).length === 1
      ? Object.keys(elements)[0]
      : envelope.data.root;
  const spec: ChatViewSpec = { root, elements };
  const structural = validateSpec(spec);
  if (!structural.valid) {
    return {
      success: false,
      error: structural.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.message)
        .join("; "),
    };
  }
  return { success: true, spec };
}
