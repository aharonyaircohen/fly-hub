/**
 * @fileType utility
 * @domain user-state
 * @pattern user-state-schema-compile
 * @ai-summary Compiles a brand's declarative namespace field-spec (from
 *   `user-state/config.json`) into a strict Zod schema. The field-spec is
 *   itself Zod-validated, so malformed brand config fails fast with a clear
 *   message instead of producing a permissive schema.
 */
import { z } from "zod";

export const NAMESPACE_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;

const fieldSpecSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
    type: z.enum(["string", "number", "boolean", "stringArray", "json"]),
    required: z.boolean().default(false),
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
  })
  .strict();

export type UserStateFieldSpec = z.infer<typeof fieldSpecSchema>;

export const namespaceSpecSchema = z
  .object({
    name: z.string().regex(NAMESPACE_NAME_PATTERN),
    version: z.number().int().min(1).default(1),
    adapter: z
      .string()
      .trim()
      .regex(
        /^(convex|cms:[a-zA-Z][a-zA-Z0-9_-]*)$/,
        'adapter must be "convex" or "cms:<collection>"',
      )
      .default("convex"),
    merge: z.enum(["replace", "shallow-merge"]).default("shallow-merge"),
    modelWritable: z.boolean().default(false),
    fields: z.array(fieldSpecSchema).min(1).max(100),
  })
  .strict();

export type UserStateNamespaceSpec = z.infer<typeof namespaceSpecSchema>;

function compileField(spec: UserStateFieldSpec): z.ZodType {
  switch (spec.type) {
    case "string": {
      let field = z.string();
      if (spec.min !== undefined) field = field.min(spec.min);
      if (spec.max !== undefined) field = field.max(spec.max);
      if (spec.pattern !== undefined)
        field = field.regex(new RegExp(spec.pattern));
      return field;
    }
    case "number": {
      let field = z.number();
      if (spec.min !== undefined) field = field.min(spec.min);
      if (spec.max !== undefined) field = field.max(spec.max);
      return field;
    }
    case "boolean":
      return z.boolean();
    case "stringArray": {
      let field = z.array(z.string());
      if (spec.min !== undefined) field = field.min(spec.min);
      if (spec.max !== undefined) field = field.max(spec.max);
      return field;
    }
    case "json":
      return z.record(z.string(), z.unknown());
  }
}

/** Compile a validated namespace spec's fields into a strict object schema. */
export function compileNamespaceSchema(
  fields: readonly UserStateFieldSpec[],
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of fields) {
    const compiled = compileField(field);
    shape[field.name] = field.required ? compiled : compiled.optional();
  }
  return z.object(shape).strict() as z.ZodType<Record<string, unknown>>;
}
