export type WorkflowRunInputField = {
  name: string;
  type: "string" | "integer" | "number" | "boolean";
  required: boolean;
  minimum?: number;
  description?: string;
};

export type WorkflowRunInputForm =
  | { kind: "fields"; fields: WorkflowRunInputField[] }
  | { kind: "json" };

export function workflowRunInputForm(
  schema: Record<string, unknown> | undefined,
): WorkflowRunInputForm {
  if (!schema) return { kind: "fields", fields: [] };
  if (
    schema.type !== "object" ||
    !schema.properties ||
    typeof schema.properties !== "object" ||
    Array.isArray(schema.properties)
  ) {
    return { kind: "json" };
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter(
          (value): value is string => typeof value === "string",
        )
      : [],
  );
  const fields: WorkflowRunInputField[] = [];
  for (const [name, value] of Object.entries(
    schema.properties as Record<string, unknown>,
  )) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { kind: "json" };
    }
    const property = value as Record<string, unknown>;
    if (
      property.type !== "string" &&
      property.type !== "integer" &&
      property.type !== "number" &&
      property.type !== "boolean"
    ) {
      return { kind: "json" };
    }
    fields.push({
      name,
      type: property.type,
      required: required.has(name),
      ...(typeof property.minimum === "number"
        ? { minimum: property.minimum }
        : {}),
      ...(typeof property.description === "string"
        ? { description: property.description }
        : {}),
    });
  }
  return { kind: "fields", fields };
}

export function parseWorkflowRunInput(
  form: WorkflowRunInputForm,
  values: Record<string, string | boolean>,
  jsonInput: string,
): Record<string, unknown> {
  if (form.kind === "json") {
    const parsed = JSON.parse(jsonInput) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Workflow input must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  }
  const input: Record<string, unknown> = {};
  for (const field of form.fields) {
    const value = values[field.name];
    if (field.type === "boolean") {
      if (value !== undefined) input[field.name] = value;
    } else if (typeof value === "string" && value !== "") {
      input[field.name] =
        field.type === "integer" || field.type === "number"
          ? Number(value)
          : value;
    }
  }
  return input;
}
