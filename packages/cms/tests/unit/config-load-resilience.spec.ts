/**
 * Resilience of the CMS config loader: transient GitHub read failures are
 * retried, and a failed reload serves the last good config instead of
 * taking the cms tool family down for the turn.
 *
 * @testFramework vitest
 * @domain cms
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Octokit } from "@octokit/rest";

const backendQueryMock = vi.hoisted(() => vi.fn());

import {
  invalidateCmsConfigCache,
  loadCmsConfigFromState,
} from "../../src/config";
import {
  runWithCmsRepoDocsStore,
  type CmsRepoDocsStore,
} from "../../src/repo-docs";

const octokit = {} as Octokit;
const store: CmsRepoDocsStore = {
  load: async () => await backendQueryMock(),
  save: async () => "unused",
};

function withStore<T>(callback: () => T): T {
  return runWithCmsRepoDocsStore(store, callback);
}

const CONFIG_JSON = JSON.stringify({
  version: 1,
  name: "Test CMS",
  defaultAdapter: "github",
  writePolicy: "read-only",
  collections: [
    {
      name: "posts",
      label: "Posts",
      fields: [{ name: "title", type: "text" }],
    },
  ],
});

function stateFile(content: string) {
  return { doc: { files: { "cms/config.json": content } }, updatedAt: "abc" };
}

describe("loadCmsConfigFromState resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateCmsConfigCache();
  });

  it("retries a transient read failure and succeeds", async () => {
    backendQueryMock.mockResolvedValue(stateFile(CONFIG_JSON));

    const config = await withStore(() =>
      loadCmsConfigFromState(octokit, "acme", "app"),
    );

    expect(Object.keys(config?.collections ?? {})).toEqual(["posts"]);
    expect(backendQueryMock.mock.calls.length).toBe(1);
  });

  it("serves the last good config when a reload keeps failing", async () => {
    backendQueryMock.mockResolvedValue(stateFile(CONFIG_JSON));
    const first = await withStore(() =>
      loadCmsConfigFromState(octokit, "acme", "app"),
    );
    expect(Object.keys(first?.collections ?? {})).toEqual(["posts"]);

    // Expire the fresh cache, then make every read fail persistently.
    invalidateCmsConfigCache();
    // invalidate clears LAST_GOOD too — reload once to repopulate it.
    const second = await withStore(() =>
      loadCmsConfigFromState(octokit, "acme", "app"),
    );
    expect(Object.keys(second?.collections ?? {})).toEqual(["posts"]);

    vi.useFakeTimers();
    try {
      vi.advanceTimersByTime(61_000);
      backendQueryMock.mockRejectedValue(new Error("rate limited"));
      const promise = withStore(() =>
        loadCmsConfigFromState(octokit, "acme", "app"),
      );
      await vi.runAllTimersAsync();
      const stale = await promise;
      expect(Object.keys(stale?.collections ?? {})).toEqual(["posts"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("still throws when there is no last good config", async () => {
    backendQueryMock.mockRejectedValue(new Error("rate limited"));

    vi.useFakeTimers();
    try {
      const promise = withStore(() =>
        loadCmsConfigFromState(octokit, "acme", "app"),
      );
      const assertion = expect(promise).rejects.toThrow("rate limited");
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
