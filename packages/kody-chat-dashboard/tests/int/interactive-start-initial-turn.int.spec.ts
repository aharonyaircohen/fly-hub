/**
 * @fileoverview Reproduction + regression test for the "vibe handoff runs but
 * nothing happens / chat sits silent" bug.
 * @testFramework vitest
 * @domain vibe
 *
 * ROOT CAUSE: the handoff used two separate persistence mutations for session
 * metadata and the first user turn. The runner could boot between them, see no
 * turn, and idle-exit with turnsCompleted:0.
 *
 * FIX: let `/interactive/start` write the meta line AND the first user turn in
 * ONE atomic backend mutation, so the runner always sees the kickoff turn on its
 * first read — no second write to race with.
 *
 * This test drives the start route with an initial `content` and asserts the
 * persisted session contains the user turn. It fails on the old route
 * (meta-only) and passes once start writes the turn atomically.
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
import { POST as startPOST } from "../../app/api/kody/chat/interactive/start/route";

const backend = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));

const GITHUB_API = "https://api.github.com";
const REAL_FETCH = globalThis.fetch;

function mockRepoConfig404(): void {
  nock(GITHUB_API)
    .get("/repos/acme/widgets/contents/kody.config.json")
    .reply(404);
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/interactive/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "acme",
      "x-kody-repo": "widgets",
    },
    body: JSON.stringify(body),
  });
}

function mockWorkflowDispatch(): void {
  nock(GITHUB_API)
    .post(/\/repos\/acme\/widgets\/actions\/workflows\/kody\.yml\/dispatches/)
    .reply(204);
}

beforeAll(() => {
  process.env.KODY_MASTER_KEY = "interactive-start-test-secret";
  nock.disableNetConnect();
});

afterAll(() => {
  nock.enableNetConnect();
  globalThis.fetch = REAL_FETCH;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRepoConfig404();
  backend.mutation.mockResolvedValue(undefined);
  backend.query.mockResolvedValue(null);
});

afterEach(() => {
  nock.cleanAll();
});

describe("POST /api/kody/chat/interactive/start — atomic initial turn", () => {
  it("writes the first user turn INTO the session file alongside meta (no separate append to race)", async () => {
    mockWorkflowDispatch();

    const res = await startPOST(
      makeRequest({
        taskId: "vibe-42-abc",
        content: "Implement issue #42 now. Plan was approved.",
        vibeMode: true,
        taskContext: { issueNumber: 42, branch: "42-fix" },
      }),
    );
    expect(res.status).toBe(200);

    const mutationArgs = backend.mutation.mock.calls.map((call) => call[1]);
    expect(mutationArgs[0]).toMatchObject({
      conversationId: "vibe-42-abc",
      runtime: { kind: "live" },
    });
    const userTurn = mutationArgs.find((args) => args.entry)?.entry;
    expect(
      userTurn,
      "start must persist the first user turn atomically with meta — " +
        "otherwise the runner boots to an empty session and idle-exits (the silent-chat bug)",
    ).toBeTruthy();
    expect(userTurn.content).toContain(
      "Implement issue #42 now. Plan was approved.",
    );
    // vibeMode → the server-only vibe primer rides along with the turn.
    expect(userTurn.content).toContain("[Vibe mode");
    expect(userTurn.content).toContain("Use the existing branch `42-fix`");
  });

  it("still writes a meta-only session when no initial content is given (back-compat)", async () => {
    mockWorkflowDispatch();

    const res = await startPOST(makeRequest({ taskId: "plain-1" }));
    expect(res.status).toBe(200);

    const mutationArgs = backend.mutation.mock.calls.map((call) => call[1]);
    expect(mutationArgs).toHaveLength(1);
    expect(mutationArgs[0]).toMatchObject({
      conversationId: "plain-1",
      runtime: { kind: "live" },
    });
  });
});
