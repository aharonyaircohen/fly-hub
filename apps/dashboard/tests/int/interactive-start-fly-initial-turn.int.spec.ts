/**
 * @fileoverview Fly-path twin of interactive-start-initial-turn.int.spec.ts.
 * @testFramework vitest
 * @domain vibe
 *
 * The "vibe handoff runs but nothing happens" fix folds the first user turn
 * into the same commit as the session meta line, so the runner sees it on its
 * first read (no racy follow-up /interactive/append). The Actions `start`
 * route is covered by its own test — but Vibe mostly runs on the FLY path
 * (`kody-live-fly` → /interactive/start-fly), which has the identical fold.
 * This pins that path: a pool claim must not skip the turn write.
 *
 * The pool client + Fly context are module-mocked (nothing boots); the octokit
 * in the mocked context captures the session-file PUT so we can assert the
 * committed JSONL contains meta + the primed user turn.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";

const claimFromPool = vi.fn();
const spawnRunner = vi.fn();
const resolveFlyContext = vi.fn();
const backend = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));
const convex = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));

vi.mock("@kody-ade/fly/runners/pool-client", () => ({
  claimFromPool: (...args: unknown[]) => claimFromPool(...args),
}));
vi.mock("@kody-ade/fly/plugin/runners/fly", () => ({
  spawnRunner: (...args: unknown[]) => spawnRunner(...args),
}));
vi.mock("@kody-ade/fly/plugin/runners/context", () => ({
  resolveFlyContext: (...args: unknown[]) => resolveFlyContext(...args),
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
  withEscapedKeys: (client: unknown) => client,
}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = convex.mutation;
    query = convex.query;
  },
}));

// Import AFTER mocks are registered.
import { POST as startFlyPOST } from "../../app/api/kody/chat/interactive/start-fly/route";

const AUTH_HEADERS = {
  "content-type": "application/json",
  "x-kody-token": "ghp_test",
  "x-kody-owner": "acme",
  "x-kody-repo": "widgets",
};

function makeRequest(body: unknown): NextRequest {
  return new NextRequest(
    "https://dash.test/api/kody/chat/interactive/start-fly",
    {
      method: "POST",
      headers: AUTH_HEADERS,
      body: JSON.stringify(body),
    },
  );
}

/**
 * A Fly context whose octokit captures the session-file write. getContent →
 * 404 (new file), createOrUpdateFileContents records the decoded JSONL.
 */
function capturingContext() {
  const createOrUpdateFileContents = vi.fn(
    async (args: { content: string }) => {
      return { data: { content: { sha: "newsha" } } };
    },
  );
  const getContent = vi.fn(async () => {
    const e = new Error("not found") as Error & { status: number };
    e.status = 404;
    throw e;
  });
  const ctx = {
    ok: true,
    context: {
      owner: "acme",
      repo: "widgets",
      githubToken: "ghp_test",
      octokit: {
        repos: {
          get: vi.fn(),
          getContent,
          createOrUpdateFileContents,
        },
        git: {
          getRef: vi.fn(async () => ({
            data: { object: { sha: "state-sha" } },
          })),
          createRef: vi.fn(),
        },
      },
      allSecrets: {},
      flyToken: "fly_test",
      perfTier: "medium",
    },
  };
  return { ctx };
}

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "interactive-start-fly-test-secret";
});

beforeEach(() => {
  backend.mutation.mockResolvedValue(undefined);
  backend.query.mockResolvedValue([]);
  process.env.CONVEX_URL = "https://example.convex.cloud";
  convex.mutation.mockResolvedValue(undefined);
  convex.query.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/kody/chat/interactive/start-fly — atomic initial turn", () => {
  it("folds the primed first turn into the session commit even on a pool claim", async () => {
    const { ctx } = capturingContext();
    resolveFlyContext.mockResolvedValue(ctx);
    claimFromPool.mockResolvedValue({ ok: true, machineId: "pool-m-1" });

    const res = await startFlyPOST(
      makeRequest({
        taskId: "vibe-77-fly",
        content: "Implement issue #77 now. Plan was approved.",
        vibeMode: true,
        taskContext: { issueNumber: 77, branch: "77-fix" },
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, runner: "pool" });
    // Claim path must not have skipped the turn write.
    expect(spawnRunner).not.toHaveBeenCalled();

    const mutationArgs = convex.mutation.mock.calls.map((call) => call[1]);
    expect(mutationArgs[0]).toMatchObject({
      conversationId: "vibe-77-fly",
      runtime: { kind: "live" },
    });
    const userTurn = mutationArgs.find((args) => args.entry)?.entry;
    expect(
      userTurn,
      "start-fly must persist the first user turn atomically with meta — " +
        "otherwise the Fly runner boots to an empty session and idle-exits",
    ).toBeTruthy();
    expect(userTurn.content).toContain("Implement issue #77 now.");
    // vibeMode → the server-only vibe primer rides along with the turn.
    expect(userTurn.content).toContain("[Vibe mode");
    expect(userTurn.content).toContain("Use the existing branch `77-fix`");
  });

  it("writes a meta-only session when no initial content is given (back-compat)", async () => {
    const { ctx } = capturingContext();
    resolveFlyContext.mockResolvedValue(ctx);
    claimFromPool.mockResolvedValue({ ok: true, machineId: "pool-m-2" });

    const res = await startFlyPOST(makeRequest({ taskId: "plain-fly" }));
    expect(res.status).toBe(200);

    const mutationArgs = convex.mutation.mock.calls.map((call) => call[1]);
    expect(mutationArgs).toHaveLength(1);
    expect(mutationArgs[0]).toMatchObject({
      conversationId: "plain-fly",
      runtime: { kind: "live" },
    });
  });
});
