/**
 * @fileType util
 * @domain view-renderers
 * @pattern renderer-template
 * @ai-summary Storage-agnostic resolution of a renderer definition's UI
 *   template against caller data: normalize values, merge defaults, and
 *   interpolate `$key` bindings into a RenderedViewUiNode tree. Extracted
 *   from renderers.ts so the spec expander and both storage backends
 *   (backend, Convex) share one implementation.
 */
import { z } from "zod";
import {
  isRenderedViewJsonValue,
  RENDER_VIEW_DIRECTIVE,
  type RenderedViewAction,
  type RenderedViewDataValue,
  type RenderedViewDirective,
  type RenderedViewUiNode,
} from "../chat-ui-actions";
import { slugifyTitle } from "@kody-ade/base/slug";
import {
  RendererActionDefaultSchema,
  type RendererValueSchema,
  type RendererUiTemplateNode,
  type ViewRendererDefinition,
} from "./definition";

export function buildRenderedViewDirective({
  id,
  definition,
  data,
}: {
  id: string;
  definition: ViewRendererDefinition;
  data: Record<string, unknown>;
}): RenderedViewDirective {
  const { ui, data: mergedData } = resolveViewRendererUi(definition, data);
  return {
    action: RENDER_VIEW_DIRECTIVE,
    view: "renderer",
    id,
    rendererSlug: definition.slug,
    rendererName: definition.name,
    resultTarget: "chat",
    ui,
    data: mergedData,
  };
}

/**
 * Resolve a definition's UI template against raw caller data. Unknown keys
 * are dropped, declared keys are normalized, defaults fill the gaps.
 */
export function resolveViewRendererUi(
  definition: ViewRendererDefinition,
  data: Record<string, unknown>,
): { ui: RenderedViewUiNode; data: Record<string, RenderedViewDataValue> } {
  const normalizedData = normalizeViewRendererData(definition, data);
  const mergedData = mergeViewRendererDefaults(definition, normalizedData);
  const ui = resolveRendererUiTemplate(definition.ui, { data: mergedData }) ?? {
    type: "stack" as const,
    children: [],
  };
  return { ui, data: mergedData };
}

type RendererUiScope = {
  data: Record<string, RenderedViewDataValue>;
  locals?: Record<string, unknown>;
};

function scopeValue(scope: RendererUiScope, root: string): unknown {
  if (root === "data") return scope.data;
  if (Object.prototype.hasOwnProperty.call(scope.data, root)) {
    return scope.data[root];
  }
  return scope.locals?.[root];
}

function resolvePath(scope: RendererUiScope, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  let value = scopeValue(scope, parts[0]);
  for (const part of parts.slice(1)) {
    if (value === null || value === undefined) return undefined;
    if (Array.isArray(value) && /^\d+$/.test(part)) {
      value = value[Number(part)];
      continue;
    }
    if (typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function resolveTemplateValue(value: string, scope: RendererUiScope): unknown {
  const exact = /^\$([a-zA-Z0-9_.-]+)$/.exec(value);
  if (exact) return resolvePath(scope, exact[1]);
  return value.replace(/\$([a-zA-Z0-9_.-]+)/g, (_match, path: string) => {
    const resolved = resolvePath(scope, path);
    return resolved === null || resolved === undefined ? "" : String(resolved);
  });
}

function resolveTemplateString(value: string, scope: RendererUiScope): string {
  const resolved = resolveTemplateValue(value, scope);
  if (resolved === null || resolved === undefined) return "";
  if (typeof resolved === "string") return resolved;
  if (typeof resolved === "number" || typeof resolved === "boolean") {
    return String(resolved);
  }
  return "";
}

function resolveTemplateAction(
  value: string | RenderedViewAction,
  scope: RendererUiScope,
): RenderedViewAction {
  const resolved =
    typeof value === "string" ? resolveTemplateValue(value, scope) : value;
  if (isRendererAction(resolved)) return normalizeRendererAction(resolved);
  const label =
    resolved === null || resolved === undefined ? "Submit" : String(resolved);
  const id = actionIdFromLabel(label);
  return { id, label, response: id };
}

function resolveRepeatedChildren(
  template: Extract<RendererUiTemplateNode, { type: "stack" | "row" | "list" }>,
  scope: RendererUiScope,
): RenderedViewUiNode[] {
  if (!template.for) {
    return (template.children ?? [])
      .map((child) => resolveRendererUiTemplate(child, scope))
      .filter((child): child is RenderedViewUiNode => Boolean(child));
  }
  const value = resolveTemplateValue(template.for, scope);
  if (!Array.isArray(value) || !template.item) return [];
  const localName = template.as ?? "item";
  return value
    .map((item, index) =>
      resolveRendererUiTemplate(template.item as RendererUiTemplateNode, {
        data: scope.data,
        locals: {
          ...(scope.locals ?? {}),
          [localName]: item,
          index,
        },
      }),
    )
    .filter((child): child is RenderedViewUiNode => Boolean(child));
}

function resolveRendererUiTemplate(
  template: RendererUiTemplateNode,
  scope: RendererUiScope,
): RenderedViewUiNode | null {
  if (
    template.type === "stack" ||
    template.type === "row" ||
    template.type === "list"
  ) {
    return {
      type: template.type,
      children: resolveRepeatedChildren(template, scope),
    };
  }
  if (template.type === "text") {
    return {
      type: "text",
      value: resolveTemplateString(template.value, scope),
      ...(template.variant ? { variant: template.variant } : {}),
    };
  }
  if (template.type === "markdown") {
    return {
      type: "markdown",
      value: resolveTemplateString(template.value, scope),
    };
  }
  if (template.type === "input") {
    return {
      type: "input",
      value: resolveTemplateString(template.value, scope),
      ...(template.label
        ? { label: resolveTemplateString(template.label, scope) }
        : {}),
      ...(template.name
        ? { name: resolveTemplateString(template.name, scope) }
        : {}),
      ...(template.inputType
        ? {
            inputType: (() => {
              const inputType = resolveTemplateString(
                template.inputType,
                scope,
              );
              return inputType === "password" || inputType === "textarea"
                ? inputType
                : "text";
            })(),
          }
        : {}),
      readOnly: template.readOnly ?? true,
    };
  }
  if (template.type === "button") {
    const action = resolveTemplateAction(template.action, scope);
    return {
      type: "button",
      label: resolveTemplateString(template.label, scope) || action.label,
      action,
    };
  }
  if (template.type === "checkbox") {
    return {
      type: "checkbox",
      name: template.name,
      value: resolveTemplateString(template.value, scope),
      label: resolveTemplateString(template.label, scope),
    };
  }
  if (template.type === "submit") {
    return {
      type: "submit",
      label: resolveTemplateString(template.label, scope) || "Submit",
    };
  }
  if (template.type === "widget") {
    const data =
      typeof template.data === "string"
        ? resolveTemplateValue(template.data, scope)
        : template.data;
    return {
      type: "widget",
      widget: template.widget,
      ...(template.version ? { version: template.version } : {}),
      ...(data !== undefined ? { data } : {}),
    };
  }
  return null;
}

function cloneDefaultValue(
  value: RenderedViewDataValue,
): RenderedViewDataValue {
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === "object"
        ? ({ ...item } as Record<string, unknown>)
        : item,
    ) as RenderedViewDataValue;
  }
  if (value && typeof value === "object") {
    return { ...value };
  }
  return value;
}

export function mergeViewRendererDefaults(
  definition: ViewRendererDefinition,
  data: Record<string, RenderedViewDataValue>,
): Record<string, RenderedViewDataValue> {
  const defaults = definition.defaults ?? {};
  const merged = Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      cloneDefaultValue(value as RenderedViewDataValue),
    ]),
  ) as Record<string, RenderedViewDataValue>;
  return { ...merged, ...data };
}

function rendererDataKeySet(definition: ViewRendererDefinition): Set<string> {
  return new Set(Object.keys(definition.data ?? {}));
}

function isRendererAction(
  value: unknown,
): value is z.infer<typeof RendererActionDefaultSchema> {
  const result = RendererActionDefaultSchema.safeParse(value);
  return result.success;
}

export function actionIdFromLabel(label: string): string {
  return slugifyTitle(label, {
    fallback: "action",
    allowUnderscore: false,
  });
}

function normalizeRendererAction(
  value: string | z.infer<typeof RendererActionDefaultSchema>,
): z.infer<typeof RendererActionDefaultSchema> {
  if (typeof value !== "string") {
    return {
      id: value.id,
      label: value.label,
      response: value.response,
      ...(value.variant ? { variant: value.variant } : {}),
      ...(value.result ? { result: value.result } : {}),
    };
  }
  const label = value.trim();
  const id = actionIdFromLabel(label);
  return { id, label, response: id };
}

function firstStringField(
  value: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) return field.trim();
    if (typeof field === "number" || typeof field === "boolean") {
      return String(field);
    }
  }
  return null;
}

function firstStringValue(value: Record<string, unknown>): string | null {
  for (const field of Object.values(value)) {
    if (typeof field === "string" && field.trim()) return field.trim();
    if (typeof field === "number" || typeof field === "boolean") {
      return String(field);
    }
  }
  return null;
}

function recordLooksLikeChoice(value: Record<string, unknown>): boolean {
  return ["label", "title", "name", "slug", "id", "value", "response"].some(
    (key) => Object.prototype.hasOwnProperty.call(value, key),
  );
}

function normalizeRendererListItem(
  value: unknown,
): z.infer<typeof RendererActionDefaultSchema> | null {
  if (typeof value === "string") return normalizeRendererAction(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return normalizeRendererAction(String(value));
  }
  if (isRendererAction(value)) return normalizeRendererAction(value);
  if (!isRecord(value)) return null;
  const label =
    firstStringField(value, [
      "label",
      "title",
      "name",
      "slug",
      "id",
      "value",
      "response",
    ]) ?? firstStringValue(value);
  if (!label) return null;
  const response =
    firstStringField(value, [
      "response",
      "slug",
      "id",
      "value",
      "title",
      "label",
      "name",
    ]) ?? label;
  const rawId =
    firstStringField(value, ["id", "slug", "value", "response"]) ?? response;
  return {
    id: actionIdFromLabel(rawId),
    label,
    response,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function primitiveRendererValue(
  value: unknown,
): RenderedViewDataValue | undefined {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

function listItemsFromValue(
  value: unknown,
): Array<z.infer<typeof RendererActionDefaultSchema>> | null {
  if (Array.isArray(value)) {
    const items = value.map(normalizeRendererListItem);
    return items.every(Boolean)
      ? (items as Array<z.infer<typeof RendererActionDefaultSchema>>)
      : null;
  }
  if (!isRecord(value)) {
    const item = normalizeRendererListItem(value);
    return item ? [item] : null;
  }

  const keys = Object.keys(value);
  const numericKeys = keys.filter((key) => /^\d+$/.test(key));
  if (numericKeys.length === keys.length && numericKeys.length > 0) {
    return listItemsFromValue(
      numericKeys
        .sort((a, b) => Number(a) - Number(b))
        .map((key) => value[key]),
    );
  }

  if (keys.length === 1) {
    return listItemsFromValue(value[keys[0]]);
  }

  if (recordLooksLikeChoice(value)) {
    const item = normalizeRendererListItem(value);
    return item ? [item] : null;
  }

  return listItemsFromValue(Object.values(value));
}

function isListRendererField(
  definition: ViewRendererDefinition,
  bind: string,
): boolean {
  const type = definition.data?.[bind]?.type ?? "value";
  return type === "actions" || type === "selection";
}

function normalizeRendererFields(
  value: unknown,
): Array<Record<string, string | boolean>> | null {
  if (!Array.isArray(value)) return null;
  const fields = value.map((item) => {
    if (!isRecord(item)) return null;
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const description =
      typeof item.description === "string" ? item.description.trim() : "";
    const fieldValue = typeof item.value === "string" ? item.value : "";
    if (!name || !label) return null;
    return {
      name,
      label,
      value: fieldValue,
      ...(description ? { description } : {}),
      ...(item.inputType === "password" || item.inputType === "textarea"
        ? { inputType: item.inputType }
        : {}),
    };
  });
  return fields.every(Boolean)
    ? (fields as Array<Record<string, string | boolean>>)
    : null;
}

function normalizeRendererFieldValue({
  definition,
  bind,
  value,
}: {
  definition: ViewRendererDefinition;
  bind: string;
  value: unknown;
}): RenderedViewDataValue {
  const valueSchema = definition.data?.[bind]?.valueSchema;
  if (valueSchema) {
    const issue = rendererValueSchemaIssue(value, valueSchema, bind);
    if (issue) throw new Error(`Invalid renderer data for "${bind}": ${issue}`);
  }
  if (definition.data?.[bind]?.type === "json") {
    if (!isRenderedViewJsonValue(value)) {
      throw new Error(`Invalid renderer data for "${bind}": expected JSON`);
    }
    return value as RenderedViewDataValue;
  }
  if ((definition.data?.[bind]?.type ?? "value") === "fields") {
    const fields = normalizeRendererFields(value);
    if (!fields) {
      throw new Error(`Invalid renderer data for "${bind}": expected fields`);
    }
    return fields;
  }
  if (isListRendererField(definition, bind)) {
    const items = listItemsFromValue(value);
    if (!items) {
      throw new Error(
        `Invalid renderer data for "${bind}": expected a list of choices`,
      );
    }
    return items;
  }
  const primitive = primitiveRendererValue(value);
  if (primitive !== undefined) return primitive;
  throw new Error(
    `Invalid renderer data for "${bind}": expected a scalar value`,
  );
}

export function normalizeViewRendererData(
  definition: ViewRendererDefinition,
  data: Record<string, unknown>,
): Record<string, RenderedViewDataValue> {
  const normalized: Record<string, RenderedViewDataValue> = {};
  for (const bind of rendererDataKeySet(definition)) {
    if (!Object.prototype.hasOwnProperty.call(data, bind)) {
      const field = definition.data?.[bind];
      if (
        field?.valueSchema &&
        !field?.optional &&
        !Object.prototype.hasOwnProperty.call(definition.defaults ?? {}, bind)
      ) {
        throw new Error(
          `Invalid renderer data for "${bind}": value is required`,
        );
      }
      continue;
    }
    const value = data[bind];
    if (value === undefined) continue;
    normalized[bind] = normalizeRendererFieldValue({
      definition,
      bind,
      value,
    });
  }
  return normalized;
}

function rendererValueSchemaIssue(
  value: unknown,
  schema: RendererValueSchema,
  path: string,
): string | null {
  if (schema.kind === "string") {
    if (typeof value !== "string") return `${path} must be a string`;
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      return `${path} is too short`;
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      return `${path} is too long`;
    }
    return null;
  }
  if (schema.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return `${path} must be a number`;
    }
    return schema.integer && !Number.isInteger(value)
      ? `${path} must be an integer`
      : null;
  }
  if (schema.kind === "boolean") {
    return typeof value === "boolean" ? null : `${path} must be a boolean`;
  }
  if (schema.kind === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      return `${path} has too few items`;
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      return `${path} has too many items`;
    }
    for (const [index, item] of value.entries()) {
      const issue = rendererValueSchemaIssue(
        item,
        schema.items,
        `${path}[${index}]`,
      );
      if (issue) return issue;
    }
    return null;
  }
  if (!isRecord(value)) return `${path} must be an object`;
  const properties = schema.properties ?? {};
  for (const required of schema.required ?? []) {
    if (!Object.prototype.hasOwnProperty.call(value, required)) {
      return `${path}.${required} is required`;
    }
  }
  if (schema.additionalProperties === false) {
    const unknownKey = Object.keys(value).find(
      (key) => !Object.prototype.hasOwnProperty.call(properties, key),
    );
    if (unknownKey) return `${path}.${unknownKey} is not allowed`;
  }
  for (const [key, childSchema] of Object.entries(properties)) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const issue = rendererValueSchemaIssue(
      value[key],
      childSchema,
      `${path}.${key}`,
    );
    if (issue) return issue;
  }
  return null;
}
