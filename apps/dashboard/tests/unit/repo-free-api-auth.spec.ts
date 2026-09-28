import { beforeEach, describe, expect, it, vi } from "vitest";

import { getStoredAuth as getDashboardAuth } from "@dashboard/lib/api/client";
import { getStoredAuth as getIntegrationAuth } from "@kody-ade/kody-chat-dashboard/integration-ts/lib/integration-api";

describe("repository-free API authentication", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
    vi.stubGlobal("window", {
      localStorage: globalThis.localStorage,
      location: { pathname: "/chat" },
    });
  });

  it("keeps the signed-in token available before the first repository is connected", () => {
    localStorage.setItem(
      "kody_auth",
      JSON.stringify({
        token: "github-token",
        owner: "",
        repo: "",
        repos: [],
        currentRepoIndex: -1,
        user: { login: "alice" },
      }),
    );

    expect(getDashboardAuth()).toMatchObject({
      token: "github-token",
      owner: "",
      repo: "",
      userLogin: "alice",
    });
    expect(getIntegrationAuth()).toMatchObject({
      token: "github-token",
      owner: "",
      repo: "",
      userLogin: "alice",
    });
  });
});
