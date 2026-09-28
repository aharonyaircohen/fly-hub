import { describe, expect, it } from "vitest";
import {
  cmsSelectionItems,
  resolveCmsItemsSource,
} from "../../src/dashboard/lib/guided-flows/cms-items";

describe("Guided Flow CMS selection items", () => {
  const source = {
    type: "cms" as const,
    collection: "children",
    labelField: "name",
    valueField: "id",
    resultField: "childId",
    filter: { field: "parent", fromResultField: "parentId" },
  };

  it("resolves a dependent filter from an earlier step result", () => {
    expect(resolveCmsItemsSource(source, { parentId: "parent-1" })).toEqual({
      type: "cms",
      collection: "children",
      labelField: "name",
      valueField: "id",
      resultField: "childId",
      filter: { field: "parent", value: "parent-1" },
    });
  });

  it("marks a dependent source unavailable until its parent is selected", () => {
    expect(resolveCmsItemsSource(source, {})).toMatchObject({
      unavailable: "missing_filter_value",
    });
  });

  it("maps CMS documents to one reusable Guided Flow action", () => {
    expect(
      cmsSelectionItems(
        {
          type: "cms",
          collection: "records",
          labelField: "name",
          valueField: "id",
          resultField: "recordId",
        },
        [
          { id: "record-1", name: "Example item" },
          { id: "record-2", name: "Second item" },
          { id: "invalid" },
        ],
      ),
    ).toEqual([
      {
        id: "continue",
        label: "Example item",
        response: "Example item",
        result: { recordId: "record-1", recordIdLabel: "Example item" },
      },
      {
        id: "continue",
        label: "Second item",
        response: "Second item",
        result: { recordId: "record-2", recordIdLabel: "Second item" },
      },
    ]);
  });
});
