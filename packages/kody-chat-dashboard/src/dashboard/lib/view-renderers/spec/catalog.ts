/**
 * @fileType util
 * @domain view-renderers
 * @pattern spec-catalog
 * @ai-summary Builds the per-request `show_view` catalog: generic atoms plus
 *   one high-level component per brand renderer definition. Produces the Zod
 *   element schema used for strict validation and the JSON Schema shown to
 *   the model. Storage-agnostic: depends only on ViewRendererDefinition.
 */
import { z } from "zod";
import type { ViewRendererDefinition } from "../definition";
import {
  ATOM_COMPONENTS,
  ATOM_COMPONENT_NAMES,
  SpecChoiceSchema,
  isAtomComponentName,
} from "./atoms";

export interface ChatViewCatalog {
  /** All component names the model may use as element `type`. */
  componentNames: string[];
  /** Per-type element schema (type + props + children), keyed by type. */
  elementSchemas: ReadonlyMap<string, z.ZodType<ChatViewSpecElement>>;
  /** Renderer definition behind each high-level component name. */
  definitionComponents: ReadonlyMap<string, ViewRendererDefinition>;
  /**
   * The main text prop per component (`Text` → `value`, `Button` →
   * `label`, definitions → first text-like data key). Used to salvage
   * props the model sent as a bare string. Absent for prop-less
   * containers, whose string props coerce to `{}`.
   */
  primaryTextProps: ReadonlyMap<string, string>;
}

export interface ChatViewSpecElement {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
}

const CHILDREN_SCHEMA = z
  .array(z.string().trim().min(1).max(64))
  .max(50)
  .optional();

const SPEC_FIELD_SCHEMA = z
  .object({
    name: z.string().trim().min(1).max(128),
    label: z.string().trim().min(1).max(256),
    description: z.string().trim().min(1).max(500).optional(),
    value: z.string().max(10_000).optional(),
    inputType: z.enum(["text", "password"]).optional(),
  })
  .strict();

/** `approval-card` → `ApprovalCard`. */
export function componentNameForSlug(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Models often send choice lists as keyed objects (`{"0": {...}}`,
 * `{approve: {...}}`) or bare strings instead of `[{label, ...}]`.
 * Normalize those shapes before strict validation.
 */
function coerceChoiceList(value: unknown): unknown {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : value;
  if (!Array.isArray(raw)) return raw;
  // Flatten one level: models sometimes wrap the list in another array.
  const items = raw.flat(1);
  return items.map((item) =>
    typeof item === "string" ? { label: item } : item,
  );
}

function propsSchemaForDataField(
  field: NonNullable<ViewRendererDefinition["data"]>[string],
): z.ZodType {
  switch (field.type ?? "value") {
    case "actions":
    case "selection":
      return z.preprocess(
        coerceChoiceList,
        z.array(SpecChoiceSchema).min(1).max(30),
      );
    case "text":
    case "markdown":
    case "input":
      return z.string().max(10_000);
    case "fields":
      return z.array(SPEC_FIELD_SCHEMA).min(1).max(30);
    default:
      return z.union([z.string().max(10_000), z.number(), z.boolean()]);
  }
}

function definitionFieldIsOptional(
  definition: ViewRendererDefinition,
  key: string,
): boolean {
  const field = definition.data?.[key];
  const hasDefault = Object.prototype.hasOwnProperty.call(
    definition.defaults ?? {},
    key,
  );
  return Boolean(field?.optional) || hasDefault;
}

export function propsSchemaForDefinition(
  definition: ViewRendererDefinition,
): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(definition.data ?? {})) {
    const base = propsSchemaForDataField(field);
    shape[key] = definitionFieldIsOptional(definition, key)
      ? base.optional()
      : base;
  }
  return z.object(shape).strict();
}

const ATOM_PRIMARY_TEXT_PROPS: Partial<
  Record<(typeof ATOM_COMPONENT_NAMES)[number], string>
> = {
  Text: "value",
  Markdown: "value",
  Input: "value",
  Button: "label",
  Submit: "label",
  Checkbox: "label",
};

const TEXT_LIKE_FIELD_TYPES = new Set(["text", "markdown", "input"]);

function primaryTextPropForDefinition(
  definition: ViewRendererDefinition,
): string | null {
  const entries = Object.entries(definition.data ?? {});
  const textLike = entries.find(([, field]) =>
    TEXT_LIKE_FIELD_TYPES.has(field.type ?? ""),
  );
  return textLike?.[0] ?? null;
}

function elementSchemaFor(
  name: string,
  props: z.ZodType,
): z.ZodType<ChatViewSpecElement> {
  return z.object({
    type: z.literal(name),
    props,
    children: CHILDREN_SCHEMA,
  }) as z.ZodType<ChatViewSpecElement>;
}

/**
 * Build the catalog for one request. Definition slugs that collide with an
 * atom component name are suffixed with `View` so both stay addressable.
 */
export function buildChatViewCatalog(
  definitions: readonly ViewRendererDefinition[],
): ChatViewCatalog {
  const definitionComponents = new Map<string, ViewRendererDefinition>();
  for (const definition of definitions) {
    let name = componentNameForSlug(definition.slug);
    if (isAtomComponentName(name)) name = `${name}View`;
    if (!definitionComponents.has(name)) {
      definitionComponents.set(name, definition);
    }
  }
  const elementSchemas = new Map<string, z.ZodType<ChatViewSpecElement>>();
  const primaryTextProps = new Map<string, string>();
  for (const [name, definition] of definitionComponents) {
    elementSchemas.set(
      name,
      elementSchemaFor(name, propsSchemaForDefinition(definition)),
    );
    const primary = primaryTextPropForDefinition(definition);
    if (primary) primaryTextProps.set(name, primary);
  }
  for (const name of ATOM_COMPONENT_NAMES) {
    elementSchemas.set(name, elementSchemaFor(name, ATOM_COMPONENTS[name]));
    const primary = ATOM_PRIMARY_TEXT_PROPS[name];
    if (primary) primaryTextProps.set(name, primary);
  }
  return {
    componentNames: [...elementSchemas.keys()],
    elementSchemas,
    definitionComponents,
    primaryTextProps,
  };
}

/**
 * JSON Schema for the `show_view` tool input. Kept intentionally shallow —
 * the component enum constrains element types, while per-component prop
 * shapes are enforced by `validateChatViewSpec` and documented in the tool
 * description (per-type prop schemas don't fit strict tool-schema subsets).
 */
export function buildShowViewInputJsonSchema(
  catalog: ChatViewCatalog,
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      root: {
        type: "string",
        description: "Key of the root element in `elements`.",
      },
      elements: {
        type: "array",
        description:
          "Flat array of elements with short unique keys you invent. " +
          "Containers reference other elements via `children` keys.",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            type: { type: "string", enum: catalog.componentNames },
            props: { type: "object", additionalProperties: true },
            children: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["key", "type", "props"],
          additionalProperties: false,
        },
      },
    },
    required: ["root", "elements"],
    additionalProperties: false,
  };
}
