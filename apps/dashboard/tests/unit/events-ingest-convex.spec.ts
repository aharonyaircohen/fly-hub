/**
 * Unit tests for POST /api/kody/events/ingest Convex persistence: valid
 * batches land in chatEvents (global tenant), auth and contract stay
 * unchanged, and a Convex outage does not break the 204 push path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getFunctionName } from "convex/server";

const convex = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    query = convex.query;
    mutation = convex.mutation;
  },
}));

const bus = vi.hoisted(() => ({
  publish: vi.fn(),
  recordIngest: vi.fn(),
}));
vi.mock("@dashboard/lib/chat-event-bus", () => bus);

vi.mock("@dashboard/lib/chat-token", () => ({
  verifySessionToken: vi.fn(
    (sessionId: string, token: string) => token === "good",
  ),
}));

vi.mock("@dashboard/lib/webhooks/github-ip", () => ({
  isFromGitHubActions: vi.fn(async () => false),
  getClientIp: vi.fn(() => "1.2.3.4"),
}));

import { _resetConvexClient } from "@dashboard/lib/backend/convex-backend";
import { POST } from "../../app/api/kody/events/ingest/route";

function makeReq(body: unknown, token = "good"): NextRequest {
  return new NextRequest(
    `https://dash.test/api/kody/events/ingest?sessionId=s1&token=${token}`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetConvexClient();
  process.env.CONVEX_URL = "https://example.convex.cloud";
});

describe("POST /api/kody/events/ingest", () => {
  it("persists a batch to Convex chatEvents and returns 204", async () => {
    convex.mutation.mockResolvedValue("id");

    const res = await POST(
      makeReq([
        { event: "chat.ready", payload: { startedAt: "t" }, runId: "r1" },
        { event: "chat.message", payload: { content: "hi" }, runId: "r1" },
      ]),
    );

    expect(res.status).toBe(204);
    expect(bus.publish).toHaveBeenCalledTimes(2);
    expect(convex.mutation).toHaveBeenCalledTimes(2);
    const [ref, args] = convex.mutation.mock.calls[0]!;
    expect(getFunctionName(ref)).toBe("chatEvents:append");
    expect(args.tenantId).toBe("global");
    expect(args.sessionId).toBe("s1");
    expect(args.event).toMatchObject({
      event: "chat.ready",
      runId: "r1",
      payload: { startedAt: "t" },
    });
    expect(typeof args.event.emittedAt).toBe("string");
  });

  it("still returns 204 when the Convex append fails", async () => {
    convex.mutation.mockRejectedValue(new Error("convex down"));

    const res = await POST(makeReq({ event: "chat.message", runId: "r1" }));

    expect(res.status).toBe(204);
    expect(bus.publish).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated requests before touching Convex", async () => {
    const res = await POST(makeReq({ event: "chat.message" }, "bad"));

    expect(res.status).toBe(403);
    expect(convex.mutation).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });

  it("rejects malformed events without persisting", async () => {
    const res = await POST(makeReq([{ payload: {} }]));

    expect(res.status).toBe(400);
    expect(convex.mutation).not.toHaveBeenCalled();
  });
});
