import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { processGuidedFlowCompletionEffects } from "../../app/api/kody/guided-flows/completion-effects";

describe("GuidedFlow completion effects", () => {
  afterEach(() => vi.restoreAllMocks());

  it("hands a configured Agency request to its owner exactly once", async () => {
    const client = {
      query: vi.fn(async () => [
        {
          instanceId: "flow-1",
          effectId: "effect-1",
          flowId: "new-agency-request",
          flowVersion: 1,
          action: "agency-request.submit",
          data: { desiredOutcome: "Keep CI healthy" },
          attempts: 0,
        },
      ]),
      mutation: vi.fn(async () => undefined),
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          handoff: {
            type: "kody",
            message: "Assess Todo keep-ci-healthy",
            displayContent: "Request submitted for assessment.",
          },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      processGuidedFlowCompletionEffects(
        new NextRequest("https://dash.test/api/kody/guided-flows", {
          headers: {
            authorization: "Bearer test",
            "transfer-encoding": "chunked",
          },
        }),
        client as never,
        {
          tenantId: "acme/app",
          actorId: "alice",
          instanceId: "flow-1",
          instanceKey: "blueprint:healthy-ci",
        },
      ),
    ).resolves.toMatchObject({
      handoff: { type: "kody", message: "Assess Todo keep-ci-healthy" },
    });
    const [calledUrl, calledInit] = vi.mocked(globalThis.fetch).mock.calls[0]!;
    if (
      !(calledUrl instanceof URL) ||
      calledUrl.href !== "https://dash.test/api/kody/agency-requests"
    ) {
      throw new Error("Agency request completion used the wrong endpoint");
    }
    if (calledInit?.method !== "POST") {
      throw new Error("Agency request completion did not use POST");
    }
    const calledHeaders = new Headers(calledInit.headers);
    expect(calledHeaders.has("transfer-encoding")).toBe(false);
    expect(JSON.parse(String(calledInit.body))).toMatchObject({
      blueprintId: "healthy-ci",
      source: {
        kind: "guided-flow",
        flowId: "new-agency-request",
      },
    });
    expect(client.query).toHaveBeenCalledWith(expect.anything(), {
      tenantId: "acme/app",
      actorId: "alice",
      instanceId: "flow-1",
    });
    expect(client.mutation).toHaveBeenCalledTimes(2);
  });
});
