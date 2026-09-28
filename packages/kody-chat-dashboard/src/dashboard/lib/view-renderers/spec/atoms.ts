/**
 * @fileType util
 * @domain view-renderers
 * @pattern spec-catalog
 * @ai-summary Generic UI atom components available to the model in every
 *   `show_view` spec, with their Zod prop schemas and prompt signatures.
 *   Atom names mirror the RenderedViewUiNode wire atoms one-to-one.
 */
import { z } from "zod";

export const CHOICE_VARIANTS = ["primary", "secondary", "danger"] as const;

/**
 * A clickable choice. `response` is the text sent back to the chat as the
 * user's reply when the choice is activated; it falls back to `label`.
 */
export const SpecChoiceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  response: z.string().trim().min(1).max(500).optional(),
  id: z.string().trim().min(1).max(64).optional(),
  variant: z.enum(CHOICE_VARIANTS).optional(),
});

export type SpecChoice = z.infer<typeof SpecChoiceSchema>;

const EMPTY_PROPS = z.object({}).strict();

/** Prop schemas for the generic atoms, keyed by catalog component name. */
export const ATOM_COMPONENTS = {
  Stack: EMPTY_PROPS,
  Row: EMPTY_PROPS,
  List: EMPTY_PROPS,
  Text: z
    .object({
      value: z.string().max(2_000),
      variant: z.enum(["title", "body", "label"]).optional(),
    })
    .strict(),
  Markdown: z.object({ value: z.string().max(10_000) }).strict(),
  Input: z
    .object({
      value: z.string().max(2_000),
      label: z.string().trim().min(1).max(80).optional(),
    })
    .strict(),
  Button: z
    .object({
      label: z.string().trim().min(1).max(200),
      response: z.string().trim().min(1).max(500),
      variant: z.enum(CHOICE_VARIANTS).optional(),
    })
    .strict(),
  Checkbox: z
    .object({
      name: z.string().trim().min(1).max(80),
      value: z.string().max(200),
      label: z.string().max(200),
    })
    .strict(),
  Submit: z
    .object({ label: z.string().trim().min(1).max(80) })
    .strict(),
} as const satisfies Record<string, z.ZodType>;

export type AtomComponentName = keyof typeof ATOM_COMPONENTS;

export const ATOM_COMPONENT_NAMES = Object.keys(
  ATOM_COMPONENTS,
) as AtomComponentName[];

export function isAtomComponentName(name: string): name is AtomComponentName {
  return Object.prototype.hasOwnProperty.call(ATOM_COMPONENTS, name);
}

/** One-line prompt signatures shown to the model for each atom. */
export const ATOM_PROMPT_SIGNATURES: Record<AtomComponentName, string> = {
  Stack: "Stack {} — vertical container; put content in children",
  Row: "Row {} — horizontal container (e.g. a button row); children",
  List: "List {} — vertical option list; children",
  Text: 'Text { value, variant?: "title"|"body"|"label" }',
  Markdown: "Markdown { value } — rich text block",
  Input: "Input { value, label? } — read-only value display",
  Button:
    'Button { label, response, variant?: "primary"|"secondary"|"danger" } — clicking sends `response` back as the user\'s reply',
  Checkbox:
    "Checkbox { name, value, label } — multi-select option; group by `name` and add a Submit",
  Submit: "Submit { label } — submits the checked options as the reply",
};
