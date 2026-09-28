import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn<() => Promise<NextResponse | null>>(async () => null),
  getRequestAuth: vi.fn((): { owner: string; repo: string } | null => ({
    owner: "acme",
    repo: "widgets",
  })),
  getUserOctokit: vi.fn(),
}));
const backend = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@kody-ade/backend/api", () => ({
  api: {
    quality: {
      getMap: "quality.getMap",
      listRuns: "quality.listRuns",
      saveAction: "quality.saveAction",
      saveJourney: "quality.saveJourney",
      saveScenario: "quality.saveScenario",
      removeAction: "quality.removeAction",
      removeJourney: "quality.removeJourney",
      removeScenario: "quality.removeScenario",
      setRunArchived: "quality.setRunArchived",
      updateRun: "quality.updateRun",
    },
  },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));

import { GET, POST } from "../../../app/api/kody/quality/[resource]/route";
import {
  DELETE,
  PATCH,
} from "../../../app/api/kody/quality/[resource]/[slug]/route";

function request(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/kody/quality/actions", {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

describe("Quality routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireKodyAuth.mockResolvedValue(null);
    auth.getRequestAuth.mockReturnValue({ owner: "acme", repo: "widgets" });
    auth.getUserOctokit.mockResolvedValue({
      rest: {
        repos: {
          get: vi.fn(async () => ({ data: { default_branch: "main" } })),
          getCommit: vi.fn(async () => ({ data: { sha: "abc123" } })),
        },
      },
    });
    backend.query.mockResolvedValue({
      actions: [],
      journeys: [],
      scenarios: [],
    });
    backend.mutation.mockResolvedValue("id-1");
  });

  it("scopes reads to the active repository", async () => {
    const response = await GET(request("GET"), {
      params: Promise.resolve({ resource: "actions" }),
    });

    expect(response.status).toBe(200);
    expect(backend.query).toHaveBeenCalledWith("quality.getMap", {
      tenantId: "acme/widgets",
    });
    await expect(response.json()).resolves.toMatchObject({
      currentSourceCommit: "abc123",
    });
  });

  it("rejects active scenarios without a repository environment", async () => {
    const response = await POST(
      request("POST", {
        slug: "reply-persists",
        journeySlugs: ["direct-chat-persists"],
        name: "Reply persists",
        kind: "persistence",
        given: "A configured model.",
        expectedVisible: "The reply remains visible.",
        expectedState: "The reply remains stored.",
        testId: "old-detached-test",
        status: "active",
      }),
      { params: Promise.resolve({ resource: "scenarios" }) },
    );

    expect(response.status).toBe(400);
    expect(backend.mutation).not.toHaveBeenCalled();
  });

  it("deletes through the dependency-safe backend mutation", async () => {
    const response = await DELETE(request("DELETE"), {
      params: Promise.resolve({ resource: "actions", slug: "send-message" }),
    });

    expect(response.status).toBe(204);
    expect(backend.mutation).toHaveBeenCalledWith("quality.removeAction", {
      tenantId: "acme/widgets",
      slug: "send-message",
    });
  });

  it("archives a Quality Run without deleting its evidence", async () => {
    const response = await PATCH(
      new NextRequest(
        "http://localhost/api/kody/quality/runs/reply-persists-run",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ runId: "run-1", archived: true }),
        },
      ),
      {
        params: Promise.resolve({
          resource: "runs",
          slug: "reply-persists-run",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(backend.mutation).toHaveBeenCalledWith(
      "quality.setRunArchived",
      expect.objectContaining({
        tenantId: "acme/widgets",
        runId: "run-1",
        runSlug: "reply-persists-run",
        archived: true,
      }),
    );
  });

  it("marks an interrupted Quality Run as cancelled", async () => {
    const response = await PATCH(
      new NextRequest(
        "http://localhost/api/kody/quality/runs/reply-persists-run",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "cancel",
            runId: "run-1",
          }),
        },
      ),
      {
        params: Promise.resolve({
          resource: "runs",
          slug: "reply-persists-run",
        }),
      },
    );

    expect(response.status).toBe(200);
    expect(backend.mutation).toHaveBeenCalledWith("quality.updateRun", {
      tenantId: "acme/widgets",
      runId: "run-1",
      status: "cancelled",
      updatedAt: expect.any(String),
      finishedAt: expect.any(String),
      error: "Cancelled by user",
    });
  });
});
