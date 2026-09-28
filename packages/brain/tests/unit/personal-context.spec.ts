import { resolveActorFromToken } from "@kody-ade/base/auth";
vi.mock("@kody-ade/base/auth", () => ({ resolveActorFromToken: vi.fn() }));

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resetPersonalBrainServicesForTests,
  setPersonalBrainServices,
} from "../../src/personal-services";
import { resolvePersonalBrainContext } from "../../src/personal-context";

describe("personal Brain context", () => {
  beforeEach(() => resetPersonalBrainServicesForTests());

  it("builds runtime ownership without repository identity", async () => {
    setPersonalBrainServices({
      resolveUser: vi.fn().mockResolvedValue({ id: "user-1", label: "User" }),
      getCredential: vi.fn().mockResolvedValue(null),
      getCredentials: vi.fn().mockResolvedValue({
        FLY_API_TOKEN: "fly-token",
        OPENROUTER_API_KEY: "model-token",
      }),
      loadState: vi.fn().mockResolvedValue(null),
      saveState: vi.fn().mockResolvedValue(undefined),
    });

    const result = await resolvePersonalBrainContext();
    expect(result).toMatchObject({
      ok: true,
      context: {
        flyToken: "fly-token",
        allSecrets: {
          OPENROUTER_API_KEY: "model-token",
        },
      },
    });
    if (result.ok) {
      expect(result.context).not.toHaveProperty("owner");
      expect(result.context).not.toHaveProperty("repo");
      expect(result.context.account).toMatch(/^user-[a-f0-9]{16}$/);
    }
  });

  it("uses the existing request PAT and verified GitHub login without changing Brain ownership", async () => {
    setPersonalBrainServices({
      resolveUser: vi.fn().mockResolvedValue({ id: "user-1", label: "User" }),
      getCredential: vi.fn(),
      getCredentials: vi
        .fn()
        .mockResolvedValue({
          FLY_API_TOKEN: "fly-token",
          GITHUB_LOGIN: "stale-login",
        }),
      loadState: vi.fn(),
      saveState: vi.fn(),
    });
    vi.mocked(resolveActorFromToken).mockResolvedValue({
      login: "pat-owner",
      githubId: 123,
      avatarUrl: "",
    });
    const result = await resolvePersonalBrainContext(
      new Request("https://dashboard.test", {
        headers: {
          "x-kody-token": "existing-pat",
          "x-kody-user-login": "untrusted-login",
        },
      }),
    );
    expect(resolveActorFromToken).toHaveBeenCalledWith("existing-pat");
    expect(result).toMatchObject({
      ok: true,
      context: {
        account: "user-c6c289e49e9c05b2",
        githubToken: "existing-pat",
        githubAccount: "pat-owner",
      },
    });
    vi.mocked(resolveActorFromToken).mockResolvedValue(null);
    expect(
      await resolvePersonalBrainContext(
        new Request("https://dashboard.test", {
          headers: { "x-kody-token": "invalid-pat" },
        }),
      ),
    ).toMatchObject({ ok: false, status: 401, error: "github_token_invalid" });
  });

  it("derives the GitHub registry owner from a stored PAT for worker restores", async () => {
    setPersonalBrainServices({
      resolveUser: vi.fn().mockResolvedValue({ id: "user-1", label: "User" }),
      getCredential: vi.fn(),
      getCredentials: vi.fn().mockResolvedValue({
        FLY_API_TOKEN: "fly-token",
        GITHUB_TOKEN: "stored-pat",
      }),
      loadState: vi.fn(),
      saveState: vi.fn(),
    });
    vi.mocked(resolveActorFromToken).mockResolvedValue({
      login: "stored-owner",
      githubId: 456,
      avatarUrl: "",
    });
    const result = await resolvePersonalBrainContext();
    expect(resolveActorFromToken).toHaveBeenCalledWith("stored-pat");
    expect(result).toMatchObject({
      ok: true,
      context: { githubToken: "stored-pat", githubAccount: "stored-owner" },
    });
  });

  it("rejects unauthenticated requests", async () => {
    setPersonalBrainServices({
      resolveUser: vi.fn().mockResolvedValue(null),
      getCredential: vi.fn(),
      getCredentials: vi.fn(),
      loadState: vi.fn(),
      saveState: vi.fn(),
    });

    expect(await resolvePersonalBrainContext()).toEqual({
      ok: false,
      status: 401,
      error: "unauthorized",
    });
  });
});
