import { describe, expect, it } from "vitest";

import {
  buildGuidedFlowFromRequestBlueprint,
  buildRequestBlueprintModelGuide,
  type RequestBlueprintDefinition,
} from "../../src/dashboard/lib/request-blueprints";

const definition: RequestBlueprintDefinition = {
  id: "prepare-release",
  version: 2,
  title: "Prepare a release",
  purpose: "Collect the decisions required to prepare a safe release.",
  introduction: {
    title: "Prepare a release request",
    guidance: "Kody will reuse repository facts and ask only for decisions.",
    actionLabel: "Begin",
  },
  allowBack: true,
  requirements: [
    {
      id: "repository-runtime",
      key: "repositoryRuntime",
      title: "Repository runtime",
      guidance: "Discover the runtime from repository files.",
      source: "kody",
      required: true,
    },
    {
      id: "release-target",
      key: "releaseTarget",
      title: "What should be released?",
      guidance: "Ask the user to name the release target.",
      source: "user",
      required: true,
    },
    {
      id: "additional-context",
      key: "additionalContext",
      title: "Anything else?",
      guidance: "Collect optional release context.",
      source: "user",
      required: false,
    },
  ],
  completion: {
    submitLabel: "Submit release request",
    handoff: "agency-request.submit",
  },
};

describe("Request Blueprint", () => {
  it("is a standalone request model that generates a Guided Flow", () => {
    const flow = buildGuidedFlowFromRequestBlueprint(definition);

    expect(flow).toMatchObject({
      id: "prepare-release",
      version: 2,
      title: "Prepare a release",
      source: {
        type: "request-blueprint",
        id: "prepare-release",
        version: 2,
      },
      controls: ["back"],
      onComplete: { action: "agency-request.submit" },
    });
    expect(flow.steps.map((step) => step.id)).toEqual([
      "introduction",
      "release-target",
      "additional-context",
    ]);
    expect(flow.steps).not.toEqual(definition.requirements);
  });

  it("does not ask for information already known when the flow is generated", () => {
    const flow = buildGuidedFlowFromRequestBlueprint(definition, {
      knownValues: { releaseTarget: "dashboard" },
    });

    expect(flow.steps.map((step) => step.id)).toEqual([
      "introduction",
      "additional-context",
    ]);
  });

  it("generates Kody guidance from the same request meaning", () => {
    const guide = buildRequestBlueprintModelGuide(definition);

    expect(guide).toContain(definition.purpose);
    expect(guide).toContain("Discover: Repository runtime");
    expect(guide).toContain("Ask user: What should be released? (required)");
    expect(guide).toContain("Ask user: Anything else? (optional)");
    expect(guide).toContain("Handoff: agency-request.submit");
    expect(guide).not.toContain("renderer");
  });

  it("rejects duplicate requirement ids and keys", () => {
    expect(() =>
      buildGuidedFlowFromRequestBlueprint({
        ...definition,
        requirements: [definition.requirements[1]!, definition.requirements[1]!],
      }),
    ).toThrow(/duplicate requirement id/i);

    expect(() =>
      buildGuidedFlowFromRequestBlueprint({
        ...definition,
        requirements: [
          definition.requirements[1]!,
          { ...definition.requirements[2]!, key: "releaseTarget" },
        ],
      }),
    ).toThrow(/duplicate requirement key/i);
  });
});
