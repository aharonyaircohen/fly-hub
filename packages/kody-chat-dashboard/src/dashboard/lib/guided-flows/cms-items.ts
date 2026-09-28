import type { CmsDocument } from "@kody-ade/cms/types";
import type {
  RenderedViewAction,
  RenderedViewCmsItemsSource,
} from "../chat-ui-actions";
import type { GuidedFlowCmsItemsSource } from "./model";

type Primitive = string | number | boolean;

function primitive(value: unknown): Primitive | undefined {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
}

export function resolveCmsItemsSource(
  source: GuidedFlowCmsItemsSource,
  flowData: Readonly<Record<string, unknown>>,
): RenderedViewCmsItemsSource {
  if (!source.filter) {
    return {
      type: "cms",
      collection: source.collection,
      labelField: source.labelField,
      valueField: source.valueField,
      resultField: source.resultField,
    };
  }
  const value = primitive(flowData[source.filter.fromResultField]);
  return {
    type: "cms",
    collection: source.collection,
    labelField: source.labelField,
    valueField: source.valueField,
    resultField: source.resultField,
    ...(value === undefined
      ? { unavailable: "missing_filter_value" as const }
      : { filter: { field: source.filter.field, value } }),
  };
}

export function cmsSelectionItems(
  source: RenderedViewCmsItemsSource,
  documents: readonly CmsDocument[],
): RenderedViewAction[] {
  return documents.flatMap((document) => {
    const value = primitive(document[source.valueField]);
    const rawLabel = primitive(document[source.labelField]);
    if (value === undefined || rawLabel === undefined) return [];
    const label = String(rawLabel);
    return [
      {
        id: "continue",
        label,
        response: label,
        result: {
          [source.resultField]: value,
          [`${source.resultField}Label`]: label,
        },
      },
    ];
  });
}
