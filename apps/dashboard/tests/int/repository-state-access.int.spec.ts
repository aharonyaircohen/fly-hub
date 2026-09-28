import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const github = vi.hoisted(() => ({ user: vi.fn(), repo: vi.fn() }));
vi.mock("@kody-ade/base/github/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kody-ade/base/github/core")>()),
  createUserOctokit: () => ({
    rest: {
      users: { getAuthenticated: github.user },
      repos: { get: github.repo },
    },
  }),
}));
import * as r0 from "../../app/api/kody/views/route";
import * as r1 from "../../app/api/kody/state-files/route";
import * as r2 from "../../app/api/kody/definition-proposals/route";
import * as r3 from "../../app/api/kody/definition-proposals/[proposalId]/route";
import * as r4 from "../../app/api/kody/workflow-events/route";
import * as r5 from "../../app/api/kody/activity/agents/route";
import * as r6 from "../../app/api/kody/blueprints/status/route";
import * as r7 from "../../app/api/kody/company/backend/import/route";
import * as r8 from "../../app/api/kody/company/pipelines/[id]/runs/route";
import * as r9 from "../../app/api/kody/company/workflows/[id]/run/route";
import * as r10 from "../../app/api/kody/quality/runs/route";
import * as r11 from "../../app/api/kody/chat/history/route";
import * as r12 from "../../app/api/kody/loops/route";
import * as r13 from "../../app/api/kody/loops/[id]/route";
import * as r14 from "../../app/api/kody/repository-models/route";
import * as r15 from "../../app/api/kody/browser/session/route";
import * as r16 from "../../app/api/kody/store-catalog/import/route";
import * as a0 from "../../../../packages/agency/src/routes/capabilities-slug";
import * as a1 from "../../../../packages/agency/src/routes/agents-slug";
import * as a2 from "../../../../packages/agency/src/routes/agency-runs-detail";
import * as a3 from "../../../../packages/agency/src/routes/cto-trust";
import * as a4 from "../../../../packages/agency/src/routes/agents";
import * as a5 from "../../../../packages/agency/src/routes/capabilities-import-skill";
import * as a6 from "../../../../packages/agency/src/routes/agency-runs";
import * as a7 from "../../../../packages/agency/src/routes/agents-slug-dispatch";
const groups = [
  { name: "capabilities-slug.ts", handlers: a0 },
  { name: "agents-slug.ts", handlers: a1 },
  { name: "agency-runs-detail.ts", handlers: a2 },
  { name: "cto-trust.ts", handlers: a3 },
  { name: "agents.ts", handlers: a4 },
  { name: "capabilities-import-skill.ts", handlers: a5 },
  { name: "agency-runs.ts", handlers: a6 },
  { name: "agents-slug-dispatch.ts", handlers: a7 },
  { name: "views/route.ts", handlers: r0 },
  { name: "state-files/route.ts", handlers: r1 },
  { name: "definition-proposals/route.ts", handlers: r2 },
  { name: "definition-proposals/[proposalId]/route.ts", handlers: r3 },
  { name: "workflow-events/route.ts", handlers: r4 },
  { name: "activity/agents/route.ts", handlers: r5 },
  { name: "blueprints/status/route.ts", handlers: r6 },
  { name: "company/backend/import/route.ts", handlers: r7 },
  { name: "company/pipelines/[id]/runs/route.ts", handlers: r8 },
  { name: "company/workflows/[id]/run/route.ts", handlers: r9 },
  { name: "quality/runs/route.ts", handlers: r10 },
  { name: "chat/history/route.ts", handlers: r11 },
  { name: "loops/route.ts", handlers: r12 },
  { name: "loops/[id]/route.ts", handlers: r13 },
  { name: "repository-models/route.ts", handlers: r14 },
  { name: "browser/session/route.ts", handlers: r15 },
  { name: "store-catalog/import/route.ts", handlers: r16 },
];
const endpoints = groups.flatMap(({ name, handlers }) =>
  Object.entries(handlers)
    .filter(
      ([method]) =>
        ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) &&
        !(name === "quality/runs/route.ts" && method === "GET"),
    )
    .map(([method, run]) => ({
      name,
      method,
      run: run as (
        req: NextRequest,
        ctx: { params: Promise<Record<string, string>> },
      ) => Promise<Response>,
    })),
);
beforeEach(() => {
  vi.clearAllMocks();
  github.user.mockResolvedValue({
    data: { login: "outsider", id: 7, avatar_url: "" },
  });
  github.repo.mockRejectedValue({ status: 404 });
});
describe.each(endpoints)("$name $method", ({ method, run }) => {
  function req() {
    return new NextRequest(
      "https://test.invalid/api?owner=private&repo=target",
      {
        method,
        headers: {
          "x-kody-token": "state-access-token",
          "x-kody-owner": "private",
          "x-kody-repo": "target",
          "content-type": "application/json",
        },
        ...(method === "GET" ? {} : { body: "{}" }),
      },
    );
  }
  it("denies an outsider before processing repository state", async () => {
    const response = await run(req(), {
      params: Promise.resolve({ id: "test", slug: "test", proposalId: "test" }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: "repository_not_found_or_inaccessible",
    });
  });
  if (method !== "GET")
    it("denies write access to read-only collaborators", async () => {
      github.repo.mockResolvedValue({ data: { permissions: { pull: true } } });
      const response = await run(req(), {
        params: Promise.resolve({
          id: "test",
          slug: "test",
          proposalId: "test",
        }),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: "write_permission_required",
      });
    });
});
