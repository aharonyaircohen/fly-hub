/**
 * @fileoverview Integration tests for /api/kody/chat/trigger.
 * @testFramework vitest
 * @domain chat-contract
 *
 * Covers the regressions we hit live:
 *  - `kody.yml` is the workflow id (not chat.yml, not a stale numeric id).
 *  - Dispatch payload is `sessionId` + `dashboardUrl` (no unknown inputs).
 *  - `dashboardUrl` carries an HMAC token query param.
 *  - `ref` is `main`.
 *  - Target repo comes from `x-kody-owner`/`x-kody-repo` headers.
 *  - Stale `KODY_CHAT_WORKFLOW_ID` env values never reach GitHub.
 *
 * Uses nock to intercept the outbound Octokit calls to api.github.com —
 * no network, no GitHub creds, no real dispatches.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import nock from "nock";
import { NextRequest } from "next/server";
import { POST as triggerPOST } from "../../app/api/kody/chat/trigger/route";

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: vi.fn(async () => ({ id: "user-1", label: "test-user" })),
}));

const convex = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = convex.mutation;
    query = convex.query;
  },
}));

const GITHUB_API = "https://api.github.com";
const REAL_FETCH = globalThis.fetch;

function mockRepoConfig404(owner = "test-owner", repo = "test-repo"): void {
  nock(GITHUB_API)
    .get(`/repos/${owner}/${repo}/contents/kody.config.json`)
    .reply(404);
}

function makeRequest(
  body: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/trigger", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test-token",
      "x-kody-owner": "test-owner",
      "x-kody-repo": "test-repo",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "test-secret-for-chat-hmac";
  // Nock won't intercept global fetch (undici) without this.
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
  globalThis.fetch = REAL_FETCH;
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CONVEX_URL = "https://example.convex.cloud";
  convex.mutation.mockResolvedValue(undefined);
  convex.query.mockResolvedValue([]);
  mockRepoConfig404();
  nock(GITHUB_API).persist().get("/user").reply(200, {
    login: "alice",
    id: 42,
    avatar_url: "https://example.test/alice.png",
  });
});

afterEach(() => {
  nock.cleanAll();
  vi.unstubAllEnvs();
});

describe("POST /api/kody/chat/trigger", () => {
  const body = {
    taskId: "sess-42",
    messages: [
      {
        role: "user" as const,
        content: "hello",
        timestamp: "2026-01-01T00:00:00Z",
      },
    ],
    dashboardUrl: "https://dash.test",
  };

  it("returns 400 when taskId is missing", async () => {
    const res = await triggerPOST(makeRequest({ messages: body.messages }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: /taskId/ });
  });

  it("returns 400 when messages are empty", async () => {
    const res = await triggerPOST(makeRequest({ taskId: "s1", messages: [] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: /messages/ });
  });

  it("dispatches kody.yml against the connected repo with only sessionId+message+dashboardUrl", async () => {
    // The dispatch assertion — this is the core regression guard.
    const dispatch = nock(GITHUB_API)
      .post(
        "/repos/test-owner/test-repo/actions/workflows/kody.yml/dispatches",
        (payload) => {
          expect(payload.ref).toBe("main");
          expect(Object.keys(payload.inputs).sort()).toEqual([
            "dashboardUrl",
            "message",
            "sessionId",
          ]);
          expect(payload.inputs.sessionId).toBe("sess-42");
          expect(payload.inputs.message).toBe("hello");
          expect(payload.inputs.dashboardUrl).toMatch(
            /^https:\/\/dash\.test\/\?conversationTenantId=user%3Auser-1&token=[a-f0-9]+$/,
          );
          return true;
        },
      )
      .reply(204);

    const res = await triggerPOST(makeRequest(body));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({
      ok: true,
      taskId: "sess-42",
      workflowId: "kody.yml",
    });
    expect(dispatch.isDone()).toBe(true);
  });

  it("ignores a stale KODY_CHAT_WORKFLOW_ID env var (even with trailing whitespace)", async () => {
    // Simulates the prod bug: env set to a numeric id with \n.
    vi.stubEnv("KODY_CHAT_WORKFLOW_ID", "259395493\n");

    // Expect the hardcoded kody.yml path — NOT the stale numeric id.
    const goodDispatch = nock(GITHUB_API)
      .post("/repos/test-owner/test-repo/actions/workflows/kody.yml/dispatches")
      .reply(204);

    const res = await triggerPOST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(goodDispatch.isDone()).toBe(true);
  });

  it("honors KODY_CHAT_WORKFLOW_REPO override over the client-connected repo", async () => {
    vi.stubEnv("KODY_CHAT_WORKFLOW_REPO", "override-owner/override-repo");
    mockRepoConfig404("override-owner", "override-repo");

    const dispatch = nock(GITHUB_API)
      .post(
        "/repos/override-owner/override-repo/actions/workflows/kody.yml/dispatches",
      )
      .reply(204);

    const res = await triggerPOST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(dispatch.isDone()).toBe(true);
  });

  it("returns 500 when GitHub rejects dispatch (surfaces real errors)", async () => {
    nock(GITHUB_API)
      .post("/repos/test-owner/test-repo/actions/workflows/kody.yml/dispatches")
      .reply(422, { message: "Unexpected inputs provided" });

    const res = await triggerPOST(makeRequest(body));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(String(data.error)).toMatch(/Unexpected inputs/);
  });
});
