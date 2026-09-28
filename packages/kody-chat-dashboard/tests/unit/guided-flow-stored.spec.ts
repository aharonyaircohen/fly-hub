import { describe, expect, it } from "vitest";

import {
  latestAvailableGuidedFlowDefinitions,
  parseGuidedFlowDefinitionRows,
  parseStoredGuidedFlowDefinitions,
} from "../../src/dashboard/lib/guided-flows/stored";

function definition(title: string) {
  return {
    id: "shared-flow",
    version: 1,
    title,
    steps: [
      {
        id: "step-1",
        title: "Step",
        explanation: "Continue.",
        rendererSlug: "approval-card",
      },
    ],
  };
}

describe("stored guided flow definitions", () => {
  it("preserves an older stored Guided Flow", () => {
    expect(
      parseStoredGuidedFlowDefinitions([definition("Repository")]),
    ).toEqual([
      expect.objectContaining({
        id: "shared-flow",
        title: "Repository",
      }),
    ]);
  });

  it("preserves a generated flow's Request Blueprint source", () => {
    const [flow] = parseStoredGuidedFlowDefinitions([
      {
        ...definition("Repository"),
        source: { type: "request-blueprint", id: "release", version: 2 },
      },
    ]);

    expect(flow?.source).toEqual({
      type: "request-blueprint",
      id: "release",
      version: 2,
    });
    expect(latestAvailableGuidedFlowDefinitions(flow ? [flow] : [])).toEqual([
      expect.objectContaining({ source: flow?.source }),
    ]);
  });

  it("preserves supported optional controls", () => {
    expect(
      parseGuidedFlowDefinitionRows([
        {
          flowId: "shared-flow",
          version: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          definition: { ...definition("Repository"), controls: ["back"] },
        },
      ]),
    ).toEqual([expect.objectContaining({ controls: ["back"] })]);
  });

  it("rejects unknown controls at the storage boundary", () => {
    expect(
      parseGuidedFlowDefinitionRows([
        {
          flowId: "shared-flow",
          version: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          definition: { ...definition("Repository"), controls: ["delete-all"] },
        },
      ]),
    ).toEqual([]);
  });

  it("rejects duplicate controls at the storage boundary", () => {
    expect(
      parseGuidedFlowDefinitionRows([
        {
          flowId: "shared-flow",
          version: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          definition: {
            ...definition("Repository"),
            controls: ["back", "back"],
          },
        },
      ]),
    ).toEqual([]);
  });

  it("rejects an action that targets an unknown step", () => {
    const repositoryDefinition = definition("Repository");
    expect(
      parseGuidedFlowDefinitionRows([
        {
          flowId: "shared-flow",
          version: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          definition: {
            ...repositoryDefinition,
            steps: [
              {
                ...repositoryDefinition.steps[0],
                actions: [
                  {
                    id: "next",
                    target: { type: "step", stepId: "missing" },
                  },
                ],
              },
            ],
          },
        },
      ]),
    ).toEqual([]);
  });

  it("prefers a repository-owned row over a legacy actor row", () => {
    expect(
      parseGuidedFlowDefinitionRows([
        {
          actorId: "alice",
          flowId: "shared-flow",
          version: 1,
          updatedAt: "2026-01-02T00:00:00.000Z",
          definition: definition("Legacy"),
        },
        {
          flowId: "shared-flow",
          version: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          definition: definition("Repository"),
        },
      ]),
    ).toEqual([expect.objectContaining({ title: "Repository" })]);
  });

  it("uses the newest legacy row until the repository republishes it", () => {
    expect(
      parseGuidedFlowDefinitionRows([
        {
          actorId: "alice",
          flowId: "shared-flow",
          version: 1,
          updatedAt: "2026-01-01T00:00:00.000Z",
          definition: definition("Older"),
        },
        {
          actorId: "bob",
          flowId: "shared-flow",
          version: 1,
          updatedAt: "2026-01-02T00:00:00.000Z",
          definition: definition("Newer"),
        },
      ]),
    ).toEqual([expect.objectContaining({ title: "Newer" })]);
  });

  it("preserves typed dynamic-page parameters", () => {
    expect(
      parseStoredGuidedFlowDefinitions([
        {
          id: "open-task",
          version: 1,
          title: "Open a task",
          completionRouteId: "task",
          completionRouteParameters: { issueNumber: "42" },
          steps: [
            {
              id: "step-1",
              title: "Review the task",
              explanation: "Review it.",
              routeId: "task",
              routeParameters: { issueNumber: "42" },
              rendererSlug: "approval-card",
              actions: [{ id: "continue", target: { type: "complete" } }],
            },
          ],
        },
      ]),
    ).toMatchObject([
      {
        completionRouteParameters: { issueNumber: "42" },
        steps: [
          expect.objectContaining({
            routeParameters: { issueNumber: "42" },
          }),
        ],
      },
    ]);
  });

  it("preserves a generic file picker on a view step", () => {
    expect(
      parseStoredGuidedFlowDefinitions([
        {
          ...definition("Pick a file"),
          steps: [
            {
              ...definition("Pick a file").steps[0],
              routeId: "files",
              filePicker: {
                resultField: "selectedFile",
                extensions: [".txt"],
              },
            },
          ],
        },
      ]),
    ).toMatchObject([
      {
        steps: [
          expect.objectContaining({
            filePicker: { resultField: "selectedFile", extensions: [".txt"] },
          }),
        ],
      },
    ]);
  });
});
