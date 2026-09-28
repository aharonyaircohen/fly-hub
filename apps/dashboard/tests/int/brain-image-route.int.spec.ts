/**
 * @fileoverview Integration coverage for Brain image save route start.
 * @testFramework vitest
 * @domain brain
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyTerminalBridgeToken } from "@kody-ade/terminal/terminal-token";
import { setPersonalBrainServices } from "@kody-ade/brain/personal-services";

const mocks = vi.hoisted(() => ({
  deleteImage: vi.fn(),
  finishSave: vi.fn(),
  getJob: vi.fn(),
  readImage: vi.fn(),
  readRuntimeView: vi.fn(),
  readSave: vi.fn(),
  startJob: vi.fn(),
  clearSave: vi.fn(),
  writeImage: vi.fn(),
  writeSave: vi.fn(),
}));
let personalCredentials: Record<string, string> = {};

function registerPersonalBrainServices() {
  setPersonalBrainServices({
    resolveUser: async () => ({ id: "user-1", label: "A Guy" }),
    getCredential: async (_userId, name) => personalCredentials[name] ?? null,
    getCredentials: async () => personalCredentials,
    loadState: async () => null,
    saveState: async () => undefined,
  });
}

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: vi.fn(async () => null),
  resolveActorFromToken: vi.fn(async (token: string) =>
    token === "connected-pat"
      ? { login: "pat-owner", githubId: 123, avatarUrl: "" }
      : null,
  ),
}));

vi.mock("@kody-ade/fly/plugin/runners/context", () => ({
  flyConfigFromContext: vi.fn((context) =>
    context.flyToken
      ? {
          token: context.flyToken,
          orgSlug: context.flyOrgSlug,
          defaultRegion: context.flyDefaultRegion,
        }
      : null,
  ),
  resolveFlyContext: vi.fn(async () => ({
    ok: true,
    context: {
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
      account: "aguyaharonyair",
      githubToken: "gh-token",
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      allSecrets: {},
      engineModel: undefined,
    },
  })),
}));

vi.mock("@dashboard/lib/github-client", () => ({
  setGitHubContext: vi.fn(),
  clearGitHubContext: vi.fn(),
}));

vi.mock("@kody-ade/brain/service-resolver", () => ({
  resolveBrainService: vi.fn(async () => ({
    app: "brain-1",
    flyToken: "fly-token",
    orgSlug: "guy-koren",
    defaultRegion: "fra",
    state: "running",
    url: "https://brain-1.fly.dev",
    machineId: "machine-1",
    stored: null,
  })),
}));

vi.mock("@kody-ade/fly/plugin/runners/brain", () => ({
  DEFAULT_IMAGE: "ghcr.io/aharonyaircohen/kody-brain:latest",
  waitForBrainHealth: vi.fn(async () => undefined),
}));

vi.mock("@kody-ade/fly/plugin/terminal/bridge", () => ({
  ensureTerminalBridge: vi.fn(async () => ({
    app: "kody-terminal-guy-koren",
    url: "https://bridge.test",
    machineId: "bridge-1",
    secret: "bridge-secret",
  })),
}));

vi.mock("@kody-ade/terminal/bridge-exec-client", () => ({
  startTerminalBridgeLocalExecJob: mocks.startJob,
  getTerminalBridgeExecJob: mocks.getJob,
}));

vi.mock("@kody-ade/brain/store", () => ({
  deleteBrainImages: mocks.deleteImage,
  readBrainImage: mocks.readImage,
  readBrainImageSave: mocks.readSave,
  writeBrainImage: mocks.writeImage,
  writeBrainImageSave: mocks.writeSave,
  clearBrainImageSave: mocks.clearSave,
}));

vi.mock("@kody-ade/brain/runtime-manager", () => ({
  readBrainRuntimeView: mocks.readRuntimeView,
  beginBrainRuntimeApply: vi.fn(async () => ({ operation: { id: "job-1" } })),
  finishBrainImageSaveOperation: mocks.finishSave,
}));

vi.mock("@kody-ade/brain/image-runtime", () => ({
  brainGhcrAuth: vi.fn(() => ({ token: "ghcr-token", user: "aguyaharonyair" })),
}));

import { DELETE, GET, POST } from "../../app/api/kody/brain/image/route";
import { resolveBrainService } from "@kody-ade/brain/service-resolver";
import { resolveFlyContext } from "@kody-ade/fly/plugin/runners/context";
import { ensureTerminalBridge } from "../../node_modules/@kody-ade/fly/src/plugin/terminal/bridge";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function request(
  method: "DELETE" | "GET" | "POST" = "POST",
  url = "https://dash.test/api/kody/brain/image",
  body: unknown = { app: "stale-app", machineId: "stale-machine" },
): NextRequest {
  return new NextRequest(url, {
    method,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
}

function mockRepoWithoutFlyToken() {
  personalCredentials = {};
  vi.mocked(resolveFlyContext).mockResolvedValueOnce({
    ok: true,
    context: {
      owner: "A-Guy-educ",
      repo: "A-Guy-Web",
      account: "aguyaharonyair",
      githubToken: "gh-token",
      flyToken: undefined,
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
      providerTokenSource: null,
      allSecrets: {},
      engineModel: undefined,
    },
  } as never);
}

describe("GET /api/kody/brain/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:30:00.000Z"));
    personalCredentials = {
      FLY_API_TOKEN: "fly-token",
      GITHUB_TOKEN: "gh-token",
      GITHUB_OWNER: "A-Guy-educ",
      GITHUB_LOGIN: "aguyaharonyair",
    };
    registerPersonalBrainServices();
    mocks.readSave.mockResolvedValue(null);
    mocks.finishSave.mockResolvedValue(undefined);
    mocks.readRuntimeView.mockResolvedValue({
      desiredImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      source: "runtime",
    });
    mocks.readImage.mockResolvedValue({
      version: 1,
      imageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [
        {
          imageRef:
            "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-07-02T10:10:10.000Z",
        },
      ],
    });
  });

  it("still exposes saved personal Brain images without a Fly token", async () => {
    mockRepoWithoutFlyToken();
    vi.stubGlobal("fetch", vi.fn());

    const res = await GET(request("GET"));

    expect(res.status).toBe(200);
    expect(mocks.readImage).toHaveBeenCalled();
  });

  it("finalizes a running save operation when its image was already cataloged", async () => {
    mocks.readRuntimeView.mockResolvedValue({
      desiredImageRef: "ghcr.io/aguy/brain:current",
      operation: {
        id: "completed-job",
        type: "save-image",
        status: "running",
        imageRef:
          "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
        startedAt: "2026-07-02T12:00:00.000Z",
        updatedAt: "2026-07-02T12:00:00.000Z",
      },
    });

    const response = await GET(request("GET"));

    expect(response.status).toBe(200);
    expect(mocks.finishSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      "completed-job",
    );
  });

  it("includes historical Brain image tags from the GHCR package", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify([
            {
              created_at: "2026-07-02T10:10:10.000Z",
              updated_at: "2026-07-02T10:10:10.000Z",
              metadata: {
                container: {
                  tags: ["brain-20260702-101010", "brain-20260701-090000"],
                },
              },
            },
          ]),
          { status: 200 },
        );
      }),
    );

    const res = await GET(request("GET"));
    const body = (await res.json()) as {
      images?: Array<{ imageRef: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.images?.map((image) => image.imageRef)).toEqual([
      "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-090000",
    ]);
  });

  it("uses the live machine image when the stored running record is missing", async () => {
    mocks.readRuntimeView.mockResolvedValueOnce({
      desiredImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      runningImageRef: null,
      source: "runtime",
    });
    vi.mocked(resolveBrainService).mockResolvedValueOnce({
      app: "brain-1",
      flyToken: "fly-token",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      state: "running",
      url: "https://brain-1.fly.dev",
      machineId: "machine-1",
      machineImageRef:
        "registry.fly.io/kody-brain-aguyaharonyair:brain-20260702-101010",
      stored: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );

    const res = await GET(request("GET"));
    const body = (await res.json()) as { runningImageRef?: string | null };

    expect(res.status).toBe(200);
    expect(body.runningImageRef).toBe(
      "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
    );
  });

  it("does not rediscover forgotten GHCR image tags", async () => {
    mocks.readImage.mockResolvedValue({
      version: 1,
      imageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [
        {
          imageRef:
            "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-07-02T10:10:10.000Z",
        },
      ],
      forgottenImageRefs: [
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-090000",
      ],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify([
            {
              created_at: "2026-07-02T10:10:10.000Z",
              updated_at: "2026-07-02T10:10:10.000Z",
              metadata: {
                container: {
                  tags: ["brain-20260702-101010", "brain-20260701-090000"],
                },
              },
            },
          ]),
          { status: 200 },
        );
      }),
    );

    const res = await GET(request("GET"));
    const body = (await res.json()) as {
      images?: Array<{ imageRef: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.images?.map((image) => image.imageRef)).toEqual([
      "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
    ]);
  });

  it("marks stale running save state as failed when loading image management", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-07T12:02:37.000Z"));
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      phase: "starting",
      message: "Starting Brain image save",
      jobId: "85fcba09827b512d308c705050fb6354",
      app: "kody-brain-aharonyaircohen",
      machineId: "89079db6d91518",
      bridgeApp: "kody-terminal-aharon-yair-cohen-44fcef106eb9",
      orgSlug: "aharon-yair-cohen",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:20260706t151218z",
      startedAt: "2026-07-06T15:12:18.390Z",
      updatedAt: "2026-07-06T15:12:18.390Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );

    const res = await GET(request("GET"));
    const body = (await res.json()) as {
      save?: {
        status?: string;
        phase?: string;
        message?: string;
        error?: string;
      };
    };

    expect(res.status).toBe(200);
    expect(body.save).toMatchObject({
      status: "failed",
      phase: "failed",
      message: "Brain image save timed out",
      error: "Brain image save timed out after 2h 0m without progress.",
    });
    expect(mocks.writeSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      expect.objectContaining({
        status: "failed",
        phase: "failed",
        message: "Brain image save timed out",
        error: "Brain image save timed out after 2h 0m without progress.",
      }),
    );
  });

  it("marks a stale running save as failed while polling its job", async () => {
    vi.setSystemTime(new Date("2026-07-09T12:00:00.000Z"));
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      phase: "pushing-image",
      message: "Pushing the Brain image to GHCR",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "machine-1",
      bridgeApp: "kody-terminal-guy-koren",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-stale",
      startedAt: "2026-07-06T12:00:00.000Z",
      updatedAt: "2026-07-06T12:00:00.000Z",
      heartbeatAt: "2026-07-06T12:00:00.000Z",
    });

    const res = await GET(
      request(
        "GET",
        "https://dash.test/api/kody/brain/image?jobId=0123456789abcdef0123456789abcdef",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({
      status: "failed",
      message: expect.stringContaining("Brain image save timed out"),
    });
    expect(mocks.writeSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      expect.objectContaining({ status: "failed", phase: "failed" }),
    );
  });

  it("keeps forgotten image tags hidden when a new save completes", async () => {
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "machine-1",
      bridgeApp: "kody-terminal-guy-koren",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000",
      startedAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-07-02T12:00:00.000Z",
    });
    mocks.readImage.mockResolvedValue({
      version: 1,
      imageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [
        {
          imageRef:
            "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-07-02T10:10:10.000Z",
        },
      ],
      forgottenImageRefs: [
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-090000",
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-100000",
      ],
    });
    mocks.getJob.mockResolvedValue({
      id: "0123456789abcdef0123456789abcdef",
      status: "completed",
      startedAt: "2026-07-02T12:00:00.000Z",
      finishedAt: "2026-07-02T12:05:00.000Z",
      code: 0,
      stdout:
        "__KODY_BRAIN_IMAGE_REF=ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000\n",
      stderr: "",
      error: null,
    });

    const res = await GET(
      request(
        "GET",
        "https://dash.test/api/kody/brain/image?jobId=0123456789abcdef0123456789abcdef",
      ),
    );

    expect(res.status).toBe(200);
    expect(
      verifyTerminalBridgeToken(mocks.getJob.mock.calls[0][0].token, {
        secret: "bridge-secret",
      }),
    ).toMatchObject({ machineId: "machine-1", localExec: true });
    expect(mocks.writeImage).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      expect.objectContaining({
        forgottenImageRefs: [
          "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-090000",
          "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260701-100000",
        ],
      }),
    );
    expect(mocks.writeImage.mock.calls[0]?.[2]).not.toHaveProperty("imageRef");
    expect(mocks.clearSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
    );
    expect(mocks.finishSave.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clearSave.mock.invocationCallOrder[0],
    );
  });

  it("returns and persists running save phase progress", async () => {
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      phase: "starting",
      message: "Starting Brain image save",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "machine-1",
      bridgeApp: "kody-terminal-guy-koren",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000",
      startedAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-07-02T12:00:00.000Z",
    });
    mocks.getJob.mockResolvedValue({
      id: "0123456789abcdef0123456789abcdef",
      status: "running",
      startedAt: "2026-07-02T12:00:00.000Z",
      finishedAt: null,
      code: null,
      stdout:
        "__KODY_BRAIN_SAVE_STAGE=push-ghcr\n__KODY_BRAIN_SAVE_HEARTBEAT=2026-07-02T12:03:04Z\n",
      stderr: "pushing layer\n",
      error: null,
    });

    const res = await GET(
      request(
        "GET",
        "https://dash.test/api/kody/brain/image?jobId=0123456789abcdef0123456789abcdef",
      ),
    );
    const body = (await res.json()) as {
      phase?: string;
      message?: string;
      heartbeatAt?: string;
      lastOutput?: string;
    };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      phase: "pushing-image",
      message: "Pushing the Brain image to GHCR",
      heartbeatAt: "2026-07-02T12:03:04Z",
      lastOutput: "pushing layer",
    });
    expect(mocks.writeSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      expect.objectContaining({
        phase: "pushing-image",
        message: "Pushing the Brain image to GHCR",
        heartbeatAt: "2026-07-02T12:03:04Z",
        lastOutput: "pushing layer",
      }),
    );
  });

  it("marks a save as interrupted when its gateway job disappeared", async () => {
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      phase: "pushing-image",
      message: "Pushing the Brain image to GHCR",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "machine-1",
      bridgeApp: "kody-terminal-guy-koren",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-interrupted",
      startedAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-07-02T12:05:00.000Z",
    });
    mocks.getJob.mockRejectedValue(
      Object.assign(new Error("job not found"), {
        status: 404,
        code: "job_not_found",
      }),
    );

    const res = await GET(
      request(
        "GET",
        "https://dash.test/api/kody/brain/image?jobId=0123456789abcdef0123456789abcdef",
      ),
    );
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toMatchObject({
      status: "failed",
      message: expect.stringContaining("interrupted"),
    });
    expect(mocks.writeSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      expect.objectContaining({ status: "failed", phase: "failed" }),
    );
  });

  it("polls a running save through the resolved Brain operation token", async () => {
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      phase: "starting",
      message: "Starting Brain image save",
      jobId: "51256ab31d0282e85f98d34a95033892",
      app: "kody-brain-aharonyaircohen",
      machineId: "857496f4e69168",
      bridgeApp: "kody-terminal-aharon-yair-cohen-44fcef106eb9",
      orgSlug: "aharon-yair-cohen",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:20260707t121923z",
      startedAt: "2026-07-07T12:19:23.583Z",
      updatedAt: "2026-07-07T12:19:23.583Z",
    });
    vi.mocked(resolveBrainService).mockResolvedValueOnce({
      app: "kody-brain-aharonyaircohen",
      orgSlug: "aharon-yair-cohen",
      defaultRegion: "fra",
      flyToken: "resolved-operation-token",
      state: "running",
      url: "https://kody-brain-aharonyaircohen.fly.dev",
      machineId: "857496f4e69168",
      stored: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    mocks.getJob.mockResolvedValue({
      id: "51256ab31d0282e85f98d34a95033892",
      status: "running",
      startedAt: "2026-07-07T12:19:23.583Z",
      finishedAt: null,
      code: null,
      stdout: "__KODY_BRAIN_SAVE_STAGE=push-ghcr\n",
      stderr: "",
      error: null,
    });

    const res = await GET(
      request(
        "GET",
        "https://dash.test/api/kody/brain/image?jobId=51256ab31d0282e85f98d34a95033892",
      ),
    );

    expect(res.status).toBe(200);
    expect(ensureTerminalBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        token: "resolved-operation-token",
        orgSlug: "aharon-yair-cohen",
      }),
    );
  });

  it("returns failed save output details while persisting the failure", async () => {
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "machine-1",
      bridgeApp: "kody-terminal-guy-koren",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000",
      startedAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-07-02T12:00:00.000Z",
    });
    mocks.getJob.mockResolvedValue({
      id: "0123456789abcdef0123456789abcdef",
      status: "failed",
      startedAt: "2026-07-02T12:00:00.000Z",
      finishedAt: "2026-07-02T12:04:00.000Z",
      code: 1,
      stdout: "__KODY_BRAIN_SAVE_STAGE=push-ghcr\n",
      stderr: "denied: permission denied\n",
      error: "push failed",
    });

    const res = await GET(
      request(
        "GET",
        "https://dash.test/api/kody/brain/image?jobId=0123456789abcdef0123456789abcdef",
      ),
    );
    const body = (await res.json()) as {
      status?: string;
      phase?: string;
      jobId?: string;
      lastOutput?: string;
    };

    expect(res.status).toBe(500);
    expect(body).toMatchObject({
      status: "failed",
      phase: "failed",
      jobId: "0123456789abcdef0123456789abcdef",
      lastOutput: "denied: permission denied",
    });
    expect(mocks.writeSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      expect.objectContaining({
        status: "failed",
        phase: "failed",
        lastOutput: "denied: permission denied",
        error: "denied: permission denied",
      }),
    );
  });

  it("completes a running save when the expected GHCR image already exists", async () => {
    mocks.readSave.mockResolvedValue({
      version: 1,
      status: "running",
      jobId: "0123456789abcdef0123456789abcdef",
      app: "brain-1",
      machineId: "machine-1",
      bridgeApp: "kody-terminal-guy-koren",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      expectedImageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000",
      startedAt: "2026-07-02T12:00:00.000Z",
      updatedAt: "2026-07-02T12:00:00.000Z",
    });
    mocks.readImage.mockResolvedValue({
      version: 1,
      imageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-101010",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify([
            {
              created_at: "2026-07-02T12:05:00.000Z",
              updated_at: "2026-07-02T12:05:00.000Z",
              metadata: {
                container: {
                  tags: ["brain-20260702-120000"],
                },
              },
            },
          ]),
          { status: 200 },
        );
      }),
    );

    const res = await GET(
      request(
        "GET",
        "https://dash.test/api/kody/brain/image?jobId=0123456789abcdef0123456789abcdef",
      ),
    );
    const body = (await res.json()) as {
      status?: string;
      imageRef?: string;
    };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      status: "completed",
      imageRef:
        "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:brain-20260702-120000",
    });
    expect(mocks.getJob).not.toHaveBeenCalled();
    expect(mocks.writeImage).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      expect.not.objectContaining({ imageRef: expect.any(String) }),
    );
    expect(mocks.clearSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
    );
  });
});

describe("DELETE /api/kody/brain/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personalCredentials = {
      FLY_API_TOKEN: "fly-token",
      GITHUB_TOKEN: "gh-token",
      GITHUB_OWNER: "A-Guy-educ",
      GITHUB_LOGIN: "aguyaharonyair",
    };
    registerPersonalBrainServices();
    mocks.readRuntimeView.mockResolvedValue({ source: "empty" });
    mocks.readImage.mockResolvedValue({
      version: 1,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [
        {
          imageRef: "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
          createdAt: "2026-06-30T00:00:00.000Z",
          updatedAt: "2026-07-02T10:10:10.000Z",
        },
      ],
    });
    mocks.deleteImage.mockResolvedValue({
      version: 1,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-07-02T10:10:10.000Z",
      images: [],
      forgottenImageRefs: ["ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old"],
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                id: 73,
                metadata: { container: { tags: ["old"] } },
              },
            ]),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 })),
    );
  });

  it("does not delete Brain images when the repo has no Fly token", async () => {
    mockRepoWithoutFlyToken();

    const res = await DELETE(
      request(
        "DELETE",
        "https://dash.test/api/kody/brain/image?imageRef=ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
      ),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "fly_token_missing",
    });
    expect(mocks.deleteImage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deletes the requested GHCR image before removing its Brain state", async () => {
    const res = await DELETE(
      request(
        "DELETE",
        "https://dash.test/api/kody/brain/image?imageRef=ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
      ),
    );

    expect(res.status).toBe(200);
    expect(mocks.deleteImage).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      ["ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old"],
    );
    expect(fetch).toHaveBeenLastCalledWith(
      "https://api.github.com/orgs/A-Guy-educ/packages/container/kody-brain-aguyaharonyair/versions/73",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("blocks deletion of the running Brain image", async () => {
    mocks.readRuntimeView.mockResolvedValueOnce({
      desiredImageRef: "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
      runningImageRef: "ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
      source: "runtime",
    });

    const res = await DELETE(
      request(
        "DELETE",
        "https://dash.test/api/kody/brain/image?imageRef=ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
      ),
    );

    expect(res.status).toBe(409);
    expect(mocks.deleteImage).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps Brain state when GHCR denies deletion", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify([
              {
                id: 73,
                metadata: { container: { tags: ["old"] } },
              },
            ]),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(new Response(null, { status: 403 })),
    );

    const res = await DELETE(
      request(
        "DELETE",
        "https://dash.test/api/kody/brain/image?imageRef=ghcr.io/a-guy-educ/kody-brain-aguyaharonyair:old",
      ),
    );

    expect(res.status).toBe(403);
    expect(mocks.deleteImage).not.toHaveBeenCalled();
  });
});

describe("POST /api/kody/brain/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    personalCredentials = {
      FLY_API_TOKEN: "fly-token",
      GITHUB_TOKEN: "gh-token",
      GITHUB_OWNER: "A-Guy-educ",
      GITHUB_LOGIN: "aguyaharonyair",
    };
    registerPersonalBrainServices();
    mocks.readImage.mockResolvedValue(null);
    mocks.readSave.mockResolvedValue(null);
    mocks.startJob.mockResolvedValue({
      id: "job-1",
      status: "running",
      startedAt: "2026-06-30T00:00:00.000Z",
      finishedAt: null,
      code: null,
      stdout: "",
      stderr: "",
      error: null,
    });
  });

  it("does not start a Brain image save when the repo has no Fly token", async () => {
    mockRepoWithoutFlyToken();

    const res = await POST(request());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "fly_token_missing",
    });
    expect(mocks.startJob).not.toHaveBeenCalled();
  });

  it("saves using the connected PAT without separate publishing credentials", async () => {
    personalCredentials = { FLY_API_TOKEN: "fly-token" };
    const { brainGhcrAuth } = await import("@kody-ade/brain/image-runtime");
    vi.mocked(brainGhcrAuth).mockImplementationOnce(
      ({ githubToken, account }) => ({ token: githubToken, user: account }),
    );
    const response = await POST(
      new NextRequest("https://dash.test/api/kody/brain/image", {
        method: "POST",
        headers: { "x-kody-token": "connected-pat" },
      }),
    );
    expect(response.status).toBe(202);
    expect(
      verifyTerminalBridgeToken(mocks.startJob.mock.calls[0][0].token, {
        secret: "bridge-secret",
      }),
    ).toMatchObject({ ghcrToken: "connected-pat", localExec: true });
    expect(await response.json()).toMatchObject({
      imageRef: expect.stringContaining(
        "ghcr.io/pat-owner/kody-brain-pat-owner:",
      ),
    });
    expect(mocks.writeSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "connected-pat",
      expect.any(Object),
    );
  });

  it("requires publishing credentials before starting an image job", async () => {
    const { brainGhcrAuth } = await import("@kody-ade/brain/image-runtime");
    vi.mocked(brainGhcrAuth).mockReturnValueOnce({
      token: "",
      user: "aguyaharonyair",
    });
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("classic PAT"),
    });
    expect(mocks.startJob).not.toHaveBeenCalled();
    expect(resolveBrainService).not.toHaveBeenCalled();
  });

  it("requires a registry username for a personal account without GitHub identity", async () => {
    delete personalCredentials.GITHUB_LOGIN;
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message: expect.stringContaining("Reconnect your GitHub account"),
    });
    expect(mocks.startJob).not.toHaveBeenCalled();
  });

  it("finds and records the personal Brain independently of the GitHub package account", async () => {
    expect((await POST(request())).status).toBe(202);
    expect(resolveBrainService).toHaveBeenCalledWith(
      expect.objectContaining({ account: "user-c6c289e49e9c05b2" }),
    );
    expect(mocks.writeSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      expect.objectContaining({ jobId: "job-1" }),
    );
  });

  it("starts a save job against the resolved Brain org, not stale client input", async () => {
    const res = await POST(request());
    const body = (await res.json()) as { status?: string; jobId?: string };

    expect(res.status).toBe(202);
    expect(body).toMatchObject({ status: "running", jobId: "job-1" });
    const command = mocks.startJob.mock.calls[0]?.[0]?.command as string;
    expect(command).toContain("app='\\''brain-1'\\''");
    expect(command).toContain("machine='\\''machine-1'\\''");
    expect(command).toContain("org='\\''guy-koren'\\''");
    expect(command).toContain('--org "$org"');
    expect(command).not.toContain("stale-app");
    expect(command).not.toContain("stale-machine");
    expect(mocks.writeSave).toHaveBeenCalledWith(
      "user-c6c289e49e9c05b2",
      "gh-token",
      expect.objectContaining({
        status: "running",
        jobId: "job-1",
        app: "brain-1",
        machineId: "machine-1",
        orgSlug: "guy-koren",
      }),
    );
  });

  it("returns a Fly authorization error before starting a save job", async () => {
    vi.mocked(resolveBrainService).mockResolvedValueOnce({
      app: "brain-1",
      orgSlug: "guy-koren",
      defaultRegion: "fra",
      flyToken: "fly-token",
      state: "off",
      stored: {
        version: 1,
        appName: "brain-1",
        orgSlug: "guy-koren",
        createdAt: "2026-07-06T10:00:00.000Z",
      },
      reason: "fly_access_denied",
    });

    const res = await POST(request());
    const body = (await res.json()) as {
      error?: string;
      message?: string;
    };

    expect(res.status).toBe(403);
    expect(body).toMatchObject({
      error: "fly_access_denied",
      message: "Fly token cannot access this Brain app.",
    });
    expect(mocks.startJob).not.toHaveBeenCalled();
  });

  it("returns a clear Fly bridge authorization error before starting a save job", async () => {
    vi.mocked(ensureTerminalBridge).mockRejectedValueOnce(
      Object.assign(
        new Error('Fly Machines API 403 on /apps: {"error":"unauthorized"}'),
        {
          status: 403,
          body: '{"error":"unauthorized"}',
          path: "/apps",
        },
      ),
    );

    const res = await POST(request());
    const body = (await res.json()) as {
      error?: string;
      message?: string;
      reason?: string;
    };

    expect(res.status).toBe(403);
    expect(body).toMatchObject({
      error: "fly_bridge_access_denied",
      message:
        "Fly token cannot create or access the terminal bridge app needed to save Brain image.",
      reason: "fly_bridge_access_denied",
    });
    expect(mocks.startJob).not.toHaveBeenCalled();
    expect(mocks.writeSave).not.toHaveBeenCalled();
  });
});
