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
import * as instructions from "../src/routes/instructions";
import * as fullInstructions from "../src/routes/instructions-full";
import * as context from "../src/routes/context";
import * as contextDetail from "../src/routes/context-slug";
import * as commands from "../src/routes/commands";
import * as commandDetail from "../src/routes/commands-slug";
import * as brands from "../src/routes/brands";
import * as brandDetail from "../src/routes/brands-slug";
import * as todos from "../src/routes/todos";
import * as todoDetail from "../src/routes/todos-slug";
import {
  createGuidanceCollectionHandlers,
  createGuidanceDetailHandlers,
} from "../src/routes/guidance";
const groups = {
  instructions,
  fullInstructions,
  context,
  contextDetail,
  commands,
  commandDetail,
  brands,
  brandDetail,
  todos,
  todoDetail,
  guidance: createGuidanceCollectionHandlers("policy"),
  guidanceDetail: createGuidanceDetailHandlers("policy"),
};
const endpoints = Object.entries(groups).flatMap(([group, handlers]) =>
  Object.entries(handlers)
    .filter(([method]) =>
      ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method),
    )
    .map(([method, run]) => ({
      group,
      method,
      run: run as (
        req: NextRequest,
        context: { params: Promise<{ slug: string }> },
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
describe.each(endpoints)("$group $method", ({ method, run }) => {
  function request() {
    return new NextRequest("https://test.invalid/api", {
      method,
      headers: {
        "x-kody-token": "workspace-matrix-token",
        "x-kody-owner": "private",
        "x-kody-repo": "target",
        "content-type": "application/json",
      },
      ...(method === "GET" ? {} : { body: "{}" }),
    });
  }
  it("rejects an unrelated account before parsing or reading repository data", async () => {
    const result = await run(request(), {
      params: Promise.resolve({ slug: "test" }),
    });
    expect(result.status).toBe(404);
    expect(await result.json()).toMatchObject({
      error: "repository_not_found_or_inaccessible",
    });
  });
  if (method !== "GET")
    it("rejects read-only collaborators before applying a write", async () => {
      github.repo.mockResolvedValue({ data: { permissions: { pull: true } } });
      const result = await run(request(), {
        params: Promise.resolve({ slug: "test" }),
      });
      expect(result.status).toBe(403);
      expect(await result.json()).toMatchObject({
        error: "write_permission_required",
      });
    });
});
