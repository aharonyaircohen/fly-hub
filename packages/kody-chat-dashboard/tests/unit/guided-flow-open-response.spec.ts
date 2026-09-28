import { describe, expect, it } from "vitest";

import { readGuidedFlowOpenPayload } from "../../src/dashboard/lib/guided-flows/open-response";

describe("GuidedFlow open response", () => {
  it("reads the current API shape from the top level", () => {
    const view = { type: "view", renderer: "question-select" };
    const compatibility = { status: "compatible" };

    expect(
      readGuidedFlowOpenPayload({
        flow: { id: "record", title: "Record", stepIndex: 11, stepCount: 20 },
        view,
        compatibility,
      }),
    ).toEqual({ view, compatibility });
  });

  it("keeps compatibility with the older nested API shape", () => {
    const view = { type: "view", renderer: "question-select" };
    const compatibility = { status: "compatible" };

    expect(
      readGuidedFlowOpenPayload({ flow: { view, compatibility } }),
    ).toEqual({ view, compatibility });
  });
});
