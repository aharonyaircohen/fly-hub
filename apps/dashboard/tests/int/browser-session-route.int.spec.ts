import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  verifyActorLogin: vi.fn(async () => ({
    identity: { login: "octocat", avatar_url: "", githubId: 1 },
  })),
}));
const context = vi.hoisted(() => ({
  config: null as null | {
    token: string;
    orgSlug: string;
    defaultRegion: string;
  },
  resolveServerProviderContext: vi.fn(async () => ({
    ok: true as const,
    context: { owner: "acme", repo: "app" },
  })),
  serverProviderConfigFromContext: vi.fn(() => context.config),
}));
const provider = vi.hoisted(() => ({
  createSession: vi.fn(async () => ({
    providerId: "fly",
    sessionId: "browser-fixed",
    appName: "kody-browser-acme-app",
    machineId: "machine-1",
    state: "started",
    region: "fra",
    endpoint: "https://kody-browser-acme-app.fly.dev",
  })),
  act: vi.fn(),
  closeSession: vi.fn(),
}));
const backend = vi.hoisted(() => ({
  query: vi.fn<() => Promise<unknown>>(async () => null),
  mutation: vi.fn(async () => true),
}));
const machineDiagnostic = vi.hoisted(() => ({
  get: vi.fn(async () => ({
    state: "started",
    checks: {},
    events: [
      { type: "start", status: "started", source: "flyd", timestamp: 1 },
    ],
    imageDigest: "sha256:safe",
  })),
}));
const browserReadiness = vi.hoisted(() => ({
  ensure: vi.fn(async () => undefined),
}));

vi.mock("@kody-ade/base/auth", () => ({
  ...auth,
  verifyRepoReadAccess: auth.requireKodyAuth,
  verifyRepoWriteAccess: auth.requireKodyAuth,
}));
vi.mock("@kody-ade/fly/infrastructure/server-context", () => context);
vi.mock("@kody-ade/fly/infrastructure/browser", () => ({
  getBrowserProvider: () => provider,
  ensureBrowserSessionReady: browserReadiness.ensure,
  browserAppName: () => "kody-browser-acme-app",
  getBrowserMachineDiagnostic: machineDiagnostic.get,
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));
vi.mock("@kody-ade/fly/browsers/security", () => ({
  validatePublicBrowserUrl: async (url: string) => url,
}));
vi.mock("@kody-ade/fly/browsers/ticket", () => ({
  deriveBrowserKey: () => Buffer.alloc(32, 1),
  mintBrowserTicket: vi.fn(() => ({
    ticket: "ticket-1",
    expiresAt: 2_000,
  })),
}));

import { GET, POST } from "../../app/api/kody/browser/session/route";

describe("browser session route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    context.config = null;
  });

  it("keeps the iframe when the repository has no Fly provider token", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/kody/browser/session?actorLogin=octocat",
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      mode: "iframe",
      reason: "fly_not_configured",
    });
    expect(provider.createSession).not.toHaveBeenCalled();
    expect(backend.query).not.toHaveBeenCalled();
  });

  it("creates a real browser through the installed provider", async () => {
    context.config = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    const response = await POST(
      new NextRequest("http://localhost/api/kody/browser/session", {
        method: "POST",
        body: JSON.stringify({
          operation: "start",
          actorLogin: "octocat",
          initialUrl: "https://example.com",
        }),
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: "remote",
      state: "running",
      streamUrl: expect.stringContaining("wss://kody-browser-acme-app.fly.dev"),
      uploadUrl: expect.stringContaining(
        "https://kody-browser-acme-app.fly.dev/upload",
      ),
    });
    expect(provider.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "acme",
        repo: "app",
        actorId: "octocat",
        initialUrl: "https://example.com",
        config: context.config,
      }),
    );
    expect(browserReadiness.ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: "kody-browser-acme-app",
        machineId: "machine-1",
      }),
    );
    const { mintBrowserTicket } = await import("@kody-ade/fly/browsers/ticket");
    expect(vi.mocked(mintBrowserTicket)).toHaveBeenCalledWith(
      expect.any(Object),
      5 * 60,
    );
    expect(vi.mocked(mintBrowserTicket)).toHaveBeenCalledWith(
      expect.any(Object),
      60 * 60,
    );
    expect(backend.mutation).toHaveBeenCalledTimes(3);
  });

  it("does not create a duplicate Machine when another server owns startup", async () => {
    context.config = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    backend.mutation.mockResolvedValueOnce(false);

    const response = await POST(
      new NextRequest("http://localhost/api/kody/browser/session", {
        method: "POST",
        body: JSON.stringify({
          operation: "start",
          actorLogin: "octocat",
          initialUrl: "https://example.com",
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "browser_start_in_progress",
      retryAfterMs: 1_000,
    });
    expect(provider.createSession).not.toHaveBeenCalled();
  });

  it("accepts only staged user-browser uploads through the action route", async () => {
    context.config = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    backend.query.mockResolvedValue({
      sessionId: "browser-fixed",
      providerId: "fly",
      appName: "kody-browser-acme-app",
      machineId: "machine-1",
      state: "running",
      currentUrl: "https://www.facebook.com/",
      viewport: { width: 1280, height: 720 },
      expiresAtMs: Date.now() + 60_000,
    });
    provider.act.mockResolvedValue({
      ok: true,
      url: "https://www.facebook.com/",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/kody/browser/session", {
        method: "POST",
        body: JSON.stringify({
          operation: "act",
          actorLogin: "octocat",
          sessionId: "browser-fixed",
          action: {
            type: "upload",
            selector: "input[type=file]",
            uploadId: "123e4567-e89b-42d3-a456-426614174000",
            capabilitySlug: "draft-facebook-personal-post",
            allowedOrigins: ["https://www.facebook.com"],
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(provider.act).toHaveBeenCalledWith(
      expect.objectContaining({ accessTicket: "ticket-1" }),
      expect.objectContaining({
        type: "upload",
        uploadId: "123e4567-e89b-42d3-a456-426614174000",
      }),
    );
  });

  it("wakes the existing browser before sending an action", async () => {
    context.config = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    backend.query.mockResolvedValue({
      sessionId: "browser-fixed",
      providerId: "fly",
      appName: "kody-browser-acme-app",
      machineId: "machine-1",
      state: "running",
      currentUrl: "https://example.com/",
      viewport: { width: 1280, height: 720 },
      expiresAtMs: Date.now() + 60_000,
    });
    provider.act.mockResolvedValue({
      ok: true,
      url: "https://example.com/",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/kody/browser/session", {
        method: "POST",
        body: JSON.stringify({
          operation: "act",
          actorLogin: "octocat",
          sessionId: "browser-fixed",
          action: { type: "scroll", deltaY: 420 },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(browserReadiness.ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: "kody-browser-acme-app",
        machineId: "machine-1",
      }),
    );
    expect(browserReadiness.ensure.mock.invocationCallOrder[0]).toBeLessThan(
      provider.act.mock.invocationCallOrder[0]!,
    );
  });

  it("resumes the same expired browser without navigating away from its page", async () => {
    context.config = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    const expiredAtMs = Date.now() - 1;
    backend.query.mockResolvedValue({
      sessionId: "browser-fixed",
      providerId: "fly",
      appName: "kody-browser-acme-app",
      machineId: "machine-1",
      state: "suspended",
      currentUrl: "https://www.facebook.com/groups/example",
      viewport: { width: 1280, height: 720 },
      expiresAtMs: expiredAtMs,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/kody/browser/session", {
        method: "POST",
        body: JSON.stringify({
          operation: "resume",
          actorLogin: "octocat",
          sessionId: "browser-fixed",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: "remote",
      sessionId: "browser-fixed",
      state: "running",
      currentUrl: "https://www.facebook.com/groups/example",
      streamUrl: expect.stringContaining("ticket-1"),
    });
    expect(browserReadiness.ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "browser-fixed",
        machineId: "machine-1",
      }),
    );
    expect(provider.act).not.toHaveBeenCalled();
    const mutationCalls = backend.mutation.mock.calls as unknown as Array<
      [unknown, Record<string, unknown>]
    >;
    const touchCall = mutationCalls.find(
      ([, input]) => input.sessionId === "browser-fixed",
    );
    expect(touchCall?.[1]).toMatchObject({
      sessionId: "browser-fixed",
      state: "running",
    });
    expect(touchCall?.[1].expiresAtMs).toEqual(expect.any(Number));
    expect(touchCall?.[1].expiresAtMs).toBeGreaterThan(expiredAtMs);
  });

  it("aligns a reused browser even when its stored URL already matches", async () => {
    context.config = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    backend.query.mockResolvedValueOnce({
      _id: "browser-session-row",
      _creationTime: Date.now() - 60_000,
      sessionId: "browser-fixed",
      providerId: "fly",
      appName: "kody-browser-acme-app",
      machineId: "machine-1",
      state: "starting",
      currentUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
      expiresAtMs: Date.now() + 60 * 60 * 1_000,
      createdAtMs: Date.now() - 60_000,
      lastActiveAtMs: Date.now() - 30_000,
    });
    provider.act.mockResolvedValueOnce({
      ok: true,
      url: "https://example.com/",
      page: {
        url: "https://example.com/",
        title: "Example Domain",
        loading: false,
        canGoBack: true,
        canGoForward: false,
        revision: 2,
      },
    });

    const response = await POST(
      new NextRequest("http://localhost/api/kody/browser/session", {
        method: "POST",
        body: JSON.stringify({
          operation: "start",
          actorLogin: "octocat",
          initialUrl: "https://example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(provider.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "browser-fixed",
        initialUrl: "https://example.com",
      }),
    );
    expect(browserReadiness.ensure).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: "kody-browser-acme-app",
        machineId: "machine-1",
      }),
    );
    expect(provider.act).toHaveBeenCalledWith(
      expect.objectContaining({ accessTicket: "ticket-1" }),
      { type: "navigate", url: "https://example.com" },
    );
    await expect(response.json()).resolves.toMatchObject({
      sessionId: "browser-fixed",
      state: "running",
      currentUrl: "https://example.com/",
    });
    const mutationCalls = backend.mutation.mock.calls as unknown as Array<
      [unknown, Record<string, unknown>]
    >;
    const saveCall = mutationCalls.find(
      ([, input]) =>
        input.sessionId === "browser-fixed" && input.state === "running",
    );
    expect(saveCall?.[1]).not.toHaveProperty("_id");
    expect(saveCall?.[1]).not.toHaveProperty("_creationTime");
    expect(saveCall?.[1]).not.toHaveProperty("createdAtMs");
    expect(saveCall?.[1]).not.toHaveProperty("lastActiveAtMs");
  });

  it("migrates an obsolete random app session to the stable repository app", async () => {
    context.config = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    backend.query.mockResolvedValueOnce({
      sessionId: "browser-fixed",
      providerId: "fly",
      appName: "obsolete-random-browser-app",
      machineId: "old-machine",
      state: "running",
      currentUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
      expiresAtMs: Date.now() + 60_000,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/kody/browser/session", {
        method: "POST",
        body: JSON.stringify({
          operation: "start",
          actorLogin: "octocat",
          initialUrl: "https://example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(provider.closeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        appName: "obsolete-random-browser-app",
        machineId: "old-machine",
      }),
    );
    expect(provider.createSession).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      state: "running",
      streamUrl: expect.stringContaining("kody-browser-acme-app.fly.dev"),
    });
  });

  it("replaces stale Convex state when its Fly Machine was destroyed", async () => {
    context.config = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    backend.query.mockResolvedValueOnce({
      sessionId: "browser-fixed",
      providerId: "fly",
      appName: "kody-browser-acme-app",
      machineId: "missing-machine",
      state: "running",
      currentUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
      expiresAtMs: Date.now() + 60_000,
    });
    browserReadiness.ensure
      .mockRejectedValueOnce(new Error("browser_machine_not_found"))
      .mockResolvedValueOnce(undefined);

    const response = await POST(
      new NextRequest("http://localhost/api/kody/browser/session", {
        method: "POST",
        body: JSON.stringify({
          operation: "start",
          actorLogin: "octocat",
          initialUrl: "https://example.com",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(provider.createSession).toHaveBeenCalledTimes(2);
    expect(browserReadiness.ensure).toHaveBeenCalledTimes(2);
  });

  it("returns only scoped Machine startup diagnostics", async () => {
    context.config = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    backend.query.mockResolvedValueOnce({
      sessionId: "browser-fixed",
      providerId: "fly",
      appName: "kody-browser-acme-app",
      machineId: "machine-1",
      state: "starting",
      currentUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
      expiresAtMs: Date.now() + 60_000,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/kody/browser/session", {
        method: "POST",
        body: JSON.stringify({
          operation: "diagnose",
          actorLogin: "octocat",
          sessionId: "browser-fixed",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(machineDiagnostic.get).toHaveBeenCalledWith(
      "kody-browser-acme-app",
      "machine-1",
      context.config,
    );
    expect(JSON.stringify(await response.json())).not.toContain("fly-token");
  });

  it("diagnoses the authenticated active browser without exposing secrets", async () => {
    context.config = {
      token: "fly-token",
      orgSlug: "personal",
      defaultRegion: "fra",
    };
    backend.query.mockResolvedValueOnce({
      sessionId: "browser-fixed",
      providerId: "fly",
      appName: "kody-browser-acme-app",
      machineId: "machine-1",
      state: "starting",
      currentUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
      expiresAtMs: Date.now() + 60_000,
    });

    const response = await GET(
      new NextRequest(
        "http://localhost/api/kody/browser/session?actorLogin=octocat&diagnose=1",
      ),
    );

    expect(response.status).toBe(200);
    expect(machineDiagnostic.get).toHaveBeenCalledWith(
      "kody-browser-acme-app",
      "machine-1",
      context.config,
    );
    expect(JSON.stringify(await response.json())).not.toContain("fly-token");
  });
});
