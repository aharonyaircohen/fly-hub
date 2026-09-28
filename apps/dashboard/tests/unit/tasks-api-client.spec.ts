import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tasksApi, taskDocsApi } from "@dashboard/lib/api/tasks";

function okResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(() =>
    Promise.resolve(okResponse({ success: true })),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respondWith(body: unknown) {
  fetchMock.mockImplementation(() => Promise.resolve(okResponse(body)));
}

function lastCall(): { url: string; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url: String(url),
    body: init?.body ? JSON.parse(String(init.body)) : {},
  };
}

describe("tasksApi.listWithMeta", () => {
  it("builds the query string from all filter params", async () => {
    respondWith({ tasks: [] });
    await tasksApi.listWithMeta({
      days: 7,
      viewMode: "running",
      page: 2,
      perPage: 25,
      status: "failed",
      label: "bug",
      priority: "high",
      q: "auth",
      sort: "updated",
      dir: "desc",
      includeDetails: false,
    });

    const url = new URL(lastCall().url, "http://localhost");
    expect(url.pathname).toBe("/api/kody/tasks");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      days: "7",
      view: "running",
      page: "2",
      perPage: "25",
      status: "failed",
      label: "bug",
      priority: "high",
      q: "auth",
      sort: "updated",
      dir: "desc",
      includeDetails: "false",
    });
  });

  it('skips "all" filter values and omits the query string when empty', async () => {
    respondWith({ tasks: [] });
    await tasksApi.listWithMeta({
      status: "all",
      label: "all",
      priority: "all",
    });
    expect(lastCall().url).toBe("/api/kody/tasks");

    await tasksApi.listWithMeta();
    expect(lastCall().url).toBe("/api/kody/tasks");
  });
});

describe("tasksApi.list / get / listClosedForGoal", () => {
  it("unwraps the tasks array from listWithMeta", async () => {
    respondWith({ tasks: [{ issueNumber: 1 }] });
    expect(await tasksApi.list()).toEqual([{ issueNumber: 1 }]);
  });

  it("fetches a single task by issue number", async () => {
    fetchMock.mockResolvedValue(
      okResponse({ task: { issueNumber: 5 }, assignees: [], comments: [] }),
    );
    const result = await tasksApi.get(5);
    expect(lastCall().url).toBe("/api/kody/tasks/issue-5");
    expect(result.task).toEqual({ issueNumber: 5 });
  });

});

describe("tasksApi.create / update", () => {
  it("POSTs the create payload as-is", async () => {
    respondWith({ issueNumber: 9 });
    await tasksApi.create({
      title: "T",
      body: "B",
      mode: "auto",
      autoTrigger: false,
    });
    const { url, body } = lastCall();
    expect(url).toBe("/api/kody/tasks");
    expect(body).toEqual({
      title: "T",
      body: "B",
      mode: "auto",
      autoTrigger: false,
    });
  });

  it("sends an update action, including actorLogin only when provided", async () => {
    await tasksApi.update(9, { title: "New", actorLogin: "alice" });
    expect(lastCall()).toMatchObject({
      url: "/api/kody/tasks/issue-9/actions",
      body: { action: "update", title: "New", actorLogin: "alice" },
    });

    await tasksApi.update(9, { body: "b" });
    expect(lastCall().body).not.toHaveProperty("actorLogin");
  });
});

describe("simple action endpoints", () => {
  const cases: Array<[string, () => Promise<unknown>, string]> = [
    ["rerun", () => tasksApi.rerun(3, "alice"), "rerun"],
    ["close", () => tasksApi.close(3, "alice"), "close"],
    ["closeIssue", () => tasksApi.closeIssue(3, "alice"), "close-issue"],
    ["closePR", () => tasksApi.closePR(3, "alice"), "close-pr"],
    ["reset", () => tasksApi.reset(3, "alice"), "reset"],
    ["reopen", () => tasksApi.reopen(3, "alice"), "reopen"],
    ["abort", () => tasksApi.abort(3, "alice"), "abort"],
    ["approveUI", () => tasksApi.approveUI(3, "alice"), "approve-ui"],
  ];

  it.each(cases)("%s posts its action with the actor", async (_n, call, action) => {
    await call();
    expect(lastCall()).toMatchObject({
      url: "/api/kody/tasks/issue-3/actions",
      body: { action, actorLogin: "alice" },
    });
  });

  it("execute posts an empty body to the start endpoint", async () => {
    await tasksApi.execute(3, "ignored");
    expect(lastCall()).toEqual({
      url: "/api/kody/tasks/issue-3/start",
      body: {},
    });
  });
});

describe("approvePR / reportIssue / comment", () => {
  it("forwards approveDrafts only when set", async () => {
    await tasksApi.approvePR(3, "alice", { approveDrafts: false });
    expect(lastCall().body).toEqual({
      action: "approve-pr",
      actorLogin: "alice",
      approveDrafts: false,
    });

    await tasksApi.approvePR(3);
    expect(lastCall().body).toEqual({ action: "approve-pr" });
  });

  it("reportIssue sends notes as the comment", async () => {
    await tasksApi.reportIssue(3, "broken build");
    expect(lastCall().body).toEqual({
      action: "report-issue",
      comment: "broken build",
    });
  });

  it("comment posts the comment action", async () => {
    await tasksApi.comment(3, "hello", "alice");
    expect(lastCall().body).toEqual({
      action: "comment",
      comment: "hello",
      actorLogin: "alice",
    });
  });
});

describe("retryWithContext / fixRequest", () => {
  it("posts @kody resume when the context is blank", async () => {
    await tasksApi.retryWithContext(3, "   ");
    expect(lastCall().body).toEqual({
      action: "comment",
      comment: "@kody resume",
    });
  });

  it("prefixes non-empty context with a bare @kody mention", async () => {
    await tasksApi.retryWithContext(3, "  fix the tests  ");
    expect(lastCall().body.comment).toBe("@kody\n\nfix the tests");
  });

  it("fixRequest posts the fix action with the description", async () => {
    await tasksApi.fixRequest(3, "adjust padding", "alice");
    expect(lastCall().body).toEqual({
      action: "fix",
      comment: "adjust padding",
      actorLogin: "alice",
    });
  });
});

describe("approveReview", () => {
  it("throws without an associated PR and never calls fetch", async () => {
    await expect(
      tasksApi.approveReview({ issueNumber: 3 } as never),
    ).rejects.toThrow("No PR associated with this task");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the PR and issue numbers", async () => {
    await tasksApi.approveReview(
      { issueNumber: 3, associatedPR: { number: 12 } } as never,
      "alice",
    );
    expect(lastCall()).toMatchObject({
      url: "/api/kody/tasks/approve-review",
      body: { prNumber: 12, issueNumber: 3, actorLogin: "alice" },
    });
  });
});

describe("assignment and labels", () => {
  it("assign/unassign send the assignee list", async () => {
    await tasksApi.assign(3, ["bob"]);
    expect(lastCall().body).toEqual({ action: "assign", assignees: ["bob"] });

    await tasksApi.unassign(3, ["bob"], "alice");
    expect(lastCall().body).toEqual({
      action: "unassign",
      assignees: ["bob"],
      actorLogin: "alice",
    });
  });

  it("queue helpers toggle the kody:queued label", async () => {
    await tasksApi.addToQueue(3);
    expect(lastCall().body).toEqual({
      action: "add-label",
      label: "kody:queued",
    });

    await tasksApi.removeFromQueue(3);
    expect(lastCall().body).toEqual({
      action: "remove-label",
      label: "kody:queued",
    });
  });

  it("addLabel/removeLabel post arbitrary labels", async () => {
    await tasksApi.addLabel(3, "bug");
    expect(lastCall().body).toEqual({ action: "add-label", label: "bug" });

    await tasksApi.removeLabel(3, "bug", "alice");
    expect(lastCall().body).toEqual({
      action: "remove-label",
      label: "bug",
      actorLogin: "alice",
    });
  });
});

describe("taskDocsApi.list", () => {
  it("lists documents, encoding the branch param", async () => {
    respondWith({ documents: [{ path: "a.md" }] });
    const docs = await taskDocsApi.list("issue-3", "feat/x y");
    expect(lastCall().url).toBe(
      "/api/kody/tasks/issue-3/docs?branch=feat%2Fx%20y",
    );
    expect(docs).toEqual([{ path: "a.md" }]);

    await taskDocsApi.list("issue-3");
    expect(lastCall().url).toBe("/api/kody/tasks/issue-3/docs");
  });
});
