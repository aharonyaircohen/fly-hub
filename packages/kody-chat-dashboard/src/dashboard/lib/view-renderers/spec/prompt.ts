/**
 * @fileType util
 * @domain view-renderers
 * @pattern spec-prompt
 * @ai-summary Compact model-facing guidance for the `show_view` spec:
 *   the flat-elements format, per-component prop signatures (brand
 *   components first), and one worked example.
 */
import type { ViewRendererDefinition } from "../definition";
import { ATOM_PROMPT_SIGNATURES } from "./atoms";
import type { ChatViewCatalog } from "./catalog";

const CHOICE_SIGNATURE =
  '{ label, response?, variant?: "primary"|"secondary"|"danger" }';

function fieldSignature(
  definition: ViewRendererDefinition,
  key: string,
): string {
  const field = definition.data?.[key];
  const optional =
    Boolean(field?.optional) ||
    Object.prototype.hasOwnProperty.call(definition.defaults ?? {}, key);
  const type =
    field?.type === "actions" || field?.type === "selection"
      ? `Array<${CHOICE_SIGNATURE}>`
      : "string";
  const description = field?.description ? ` — ${field.description}` : "";
  return `${key}${optional ? "?" : ""}: ${type}${description}`;
}

function definitionComponentLine(
  name: string,
  definition: ViewRendererDefinition,
): string {
  const usage = [definition.description, definition.rule]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");
  const props = Object.keys(definition.data ?? {})
    .map((key) => fieldSignature(definition, key))
    .join("; ");
  return `- ${name} { ${props} }${usage ? `\n  ${usage}` : ""}`;
}

const SINGLE_COMPONENT_EXAMPLE = `{
  "root": "card",
  "elements": [
    {
      "key": "card",
      "type": "MultiSelectList",
      "props": {
        "title": "Pick a few items",
        "items": [ { "label": "Alpha" }, { "label": "Beta" }, { "label": "Gamma" } ]
      }
    }
  ]
}`;

const SPEC_EXAMPLE = `{
  "root": "card",
  "elements": [
    { "key": "card", "type": "Stack", "props": {}, "children": ["title", "actions"] },
    { "key": "title", "type": "Text", "props": { "value": "Publish the lesson?", "variant": "title" } },
    { "key": "actions", "type": "Row", "props": {}, "children": ["ok", "no"] },
    { "key": "ok", "type": "Button", "props": { "label": "Publish", "response": "publish", "variant": "primary" } },
    { "key": "no", "type": "Button", "props": { "label": "Cancel", "response": "cancel" } }
  ]
}`;

/**
 * Build the `show_view` guidance appended to the tool description and the
 * system prompt's renderer section.
 */
export function buildShowViewGuidance(catalog: ChatViewCatalog): string {
  const definitionLines = [...catalog.definitionComponents.entries()].map(
    ([name, definition]) => definitionComponentLine(name, definition),
  );
  return [
    "Spec format: `{ root, elements }` — `elements` is a flat array; every element has a short unique `key`; `root` names the top key; containers list child keys in `children`.",
    definitionLines.length > 0
      ? `View components (prefer one of these when its purpose matches the interaction):\n${definitionLines.join("\n")}`
      : null,
    `Atoms for custom layouts:\n${Object.values(ATOM_PROMPT_SIGNATURES)
      .map((line) => `- ${line}`)
      .join("\n")}`,
    'Buttons and choices send their `response` text back as the user\'s next message — make responses short, stable tokens (e.g. "approve"), not sentences.',
    "If the user's new message is NOT an answer to the previous card, that card is dismissed — build the new view only for the new message; never re-render or merge the previous card's question into it.",
    "Write all user-visible text (labels, titles) in the user's language.",
    "Every element MUST have a `type` from the lists above and an object `props`. Most interactions need only ONE view component element:",
    `Example (preferred — one view component):\n${SINGLE_COMPONENT_EXAMPLE}`,
    `Example (custom layout from atoms):\n${SPEC_EXAMPLE}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Short per-component rule list for the system prompt (when to end a turn
 * with `show_view` at all).
 */
export function buildViewComponentRules(
  catalog: ChatViewCatalog,
): string | null {
  const lines = [...catalog.definitionComponents.entries()]
    .filter(([, definition]) => definition.rule?.trim())
    .map(([name, definition]) => `- ${name}: ${definition.rule?.trim()}`);
  return lines.length > 0 ? lines.join("\n") : null;
}
