import {
  serializeViewRendererDefinition,
  type ViewRendererDefinition,
} from "./renderers";

export type ViewRendererRowSource = "personal" | "repo" | "builtin";

export function viewRendererSourceForScope(
  hasRepository: boolean,
  source: "repo" | "builtin",
): ViewRendererRowSource {
  if (source === "builtin") return "builtin";
  return hasRepository ? "repo" : "personal";
}

export function toViewRendererRow(
  definition: ViewRendererDefinition,
  options: {
    htmlUrl?: string;
    source: ViewRendererRowSource;
  },
) {
  return {
    slug: definition.slug,
    name: definition.name,
    description: definition.description ?? "",
    purpose: definition.purpose,
    rule: definition.rule ?? "",
    data: definition.data ?? {},
    defaults: definition.defaults ?? {},
    type: definition.type,
    ui: definition.ui,
    source: options.source,
    htmlUrl: options.htmlUrl ?? "",
    definition: serializeViewRendererDefinition(definition),
  };
}
