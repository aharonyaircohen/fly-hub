import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  actor: vi.fn(),
  context: vi.fn(),
  cfg: vi.fn(),
  apps: vi.fn(),
  volumes: vi.fn(),
  snapshot: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@kody-ade/base/auth", () => ({
  requireKodyAuth: mocks.auth,
  verifyActorLogin: mocks.actor,
}));
vi.mock("../../src/infrastructure/server-context", () => ({
  resolveServerProviderContext: mocks.context,
  serverProviderConfigFromContext: mocks.cfg,
}));
vi.mock("../../src/plugin/previews/machines-client", () => ({
  listAppsByPrefix: mocks.apps,
}));
vi.mock("../../src/apps/resources-client", () => ({
  listVolumes: mocks.volumes,
  snapshotVolume: mocks.snapshot,
  deleteVolume: mocks.remove,
}));

import { GET, POST } from "../../src/routes/fly-volumes";

const request = (body?: unknown) =>
  new NextRequest("http://localhost/api/kody/fly/volumes", {
    method: body ? "POST" : "GET",
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.actor.mockResolvedValue({ identity: { login: "alice" } });
  mocks.context.mockResolvedValue({ ok: true, context: {} });
  mocks.cfg.mockReturnValue({
    token: "private",
    orgSlug: "team",
    defaultRegion: "ams",
  });
  mocks.apps.mockResolvedValue(["kody-app-notebook-123", "unrelated-app"]);
  mocks.volumes.mockResolvedValue([
    {
      id: "vol_1",
      name: "data",
      region: "ams",
      state: "created",
      size_gb: 10,
      encrypted: true,
      attached_machine_id: "machine_1",
      created_at: "2026-09-11T10:00:00.000Z",
    },
  ]);
});

describe("Fly volumes route", () => {
  it("lists normalized volumes only from Kody-managed apps", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      volumes: [
        {
          app: "kody-app-notebook-123",
          id: "vol_1",
          name: "data",
          region: "ams",
          state: "created",
          sizeGb: 10,
          encrypted: true,
          attachedMachineId: "machine_1",
          createdAt: "2026-09-11T10:00:00.000Z",
        },
      ],
      unavailableApps: [],
    });
    expect(mocks.volumes).toHaveBeenCalledTimes(1);
    expect(mocks.volumes).toHaveBeenCalledWith(
      "kody-app-notebook-123",
      expect.objectContaining({ token: "private" }),
    );
  });

  it("snapshots an owned volume", async () => {
    const response = await POST(
      request({
        app: "kody-app-notebook-123",
        volumeId: "vol_1",
        action: "snapshot",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.snapshot).toHaveBeenCalledWith(
      "kody-app-notebook-123",
      "vol_1",
      expect.any(Object),
    );
  });

  it("does not delete an attached volume", async () => {
    const response = await POST(
      request({
        app: "kody-app-notebook-123",
        volumeId: "vol_1",
        action: "delete",
        actorLogin: "alice",
      }),
    );
    expect(response.status).toBe(409);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("identity-checks, snapshots, and deletes a detached volume", async () => {
    mocks.volumes.mockResolvedValue([
      { id: "vol_1", attached_machine_id: null },
    ]);
    const response = await POST(
      request({
        app: "kody-app-notebook-123",
        volumeId: "vol_1",
        action: "delete",
        actorLogin: "alice",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.actor).toHaveBeenCalledWith(expect.anything(), "alice");
    expect(mocks.snapshot).toHaveBeenCalledBefore(mocks.remove);
  });

  it("requires authentication before reading infrastructure", async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({}, { status: 401 }));
    expect((await GET(request())).status).toBe(401);
    expect(mocks.apps).not.toHaveBeenCalled();
  });
});
