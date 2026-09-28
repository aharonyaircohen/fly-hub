import { z } from "zod";

export type WorkflowInputSchema = Record<string, unknown>;

export interface WorkflowInputIssue {
  code: string;
  path: string;
  message: string;
}

function issuePath(path: PropertyKey[]): string {
  if (path.length === 0) return "input";
  return `input.${path.map(String).join(".")}`;
}

function compileWorkflowInputSchema(schema: WorkflowInputSchema) {
  return z.fromJSONSchema(schema as never);
}

export function validateWorkflowInputSchema(
  schema: WorkflowInputSchema | undefined,
): WorkflowInputIssue[] {
  if (!schema) return [];
  try {
    compileWorkflowInputSchema(schema);
    return [];
  } catch (error) {
    return [
      {
        code: "invalid_workflow_input_schema",
        path: "inputSchema",
        message:
          error instanceof Error
            ? error.message
            : "Workflow input schema is invalid.",
      },
    ];
  }
}

export function validateWorkflowInput(
  input: Record<string, unknown>,
  schema: WorkflowInputSchema | undefined,
): WorkflowInputIssue[] {
  if (!schema) return [];
  let validator: ReturnType<typeof compileWorkflowInputSchema>;
  try {
    validator = compileWorkflowInputSchema(schema);
  } catch {
    return validateWorkflowInputSchema(schema);
  }
  const result = validator.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({
    code: "invalid_workflow_input",
    path: issuePath(issue.path),
    message: issue.message,
  }));
}

/** Converts only unambiguous top-level primitive strings declared by a Workflow. */
export function coerceWorkflowInput(
  input: Record<string, unknown>,
  schema: WorkflowInputSchema | undefined,
): Record<string, unknown> {
  if (
    schema?.type !== "object" ||
    !schema.properties ||
    typeof schema.properties !== "object" ||
    Array.isArray(schema.properties)
  ) {
    return { ...input };
  }
  const properties = schema.properties as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      const property = properties[key];
      if (
        typeof value !== "string" ||
        !property ||
        typeof property !== "object" ||
        Array.isArray(property)
      ) {
        return [key, value];
      }
      const type = (property as Record<string, unknown>).type;
      const trimmed = value.trim();
      if (type === "integer" && /^-?(?:0|[1-9]\d*)$/.test(trimmed)) {
        const number = Number(trimmed);
        if (Number.isSafeInteger(number)) return [key, number];
      }
      if (type === "number" && trimmed !== "" && Number.isFinite(Number(trimmed))) {
        return [key, Number(trimmed)];
      }
      if (type === "boolean" && (trimmed === "true" || trimmed === "false")) {
        return [key, trimmed === "true"];
      }
      return [key, value];
    }),
  );
}

/** Selects the fields a strict Workflow declares from shared Pipeline facts. */
export function workflowInputFromFacts(
  facts: Record<string, unknown>,
  schema: WorkflowInputSchema | undefined,
): Record<string, unknown> {
  if (
    schema?.type !== "object" ||
    schema.additionalProperties !== false ||
    !schema.properties ||
    typeof schema.properties !== "object" ||
    Array.isArray(schema.properties)
  ) {
    return { ...facts };
  }
  const declared = new Set(Object.keys(schema.properties));
  return Object.fromEntries(
    Object.entries(facts).filter(([key]) => declared.has(key)),
  );
}
