import type {
  RendererUiTemplateNode,
  ViewRendererDefinition,
} from "./definition";

function containsWidget(node: RendererUiTemplateNode): boolean {
  if (node.type === "widget") return true;
  if (node.type !== "stack" && node.type !== "row" && node.type !== "list") {
    return false;
  }
  return (
    (node.children?.some(containsWidget) ?? false) ||
    (node.item ? containsWidget(node.item) : false)
  );
}

/** Classifies presentation only; Guided Flow still stores a normal view step. */
export function isWidgetViewRenderer(
  definition: ViewRendererDefinition,
): boolean {
  return containsWidget(definition.ui);
}
