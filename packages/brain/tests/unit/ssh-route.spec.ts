import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  overview: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../../src/personal-context", () => ({
  resolvePersonalBrainContext: mocks.context,
}));
vi.mock("../../src/overview", () => ({ readBrainOverview: mocks.overview }));
vi.mock("@kody-ade/fly/routes/fly-machines-ssh", async () => {
  const { z } = await import("zod");
  return {
    downloadAuthorizedMachineSsh: mocks.download,
    machineSshTargetSchema: z.object({
      app: z.string(),
      machineId: z.string(),
    }),
  };
});
import { POST } from "../../src/routes/ssh";
const req = () =>
  new NextRequest("http://localhost/api/kody/fly/machines/ssh", {
    method: "POST",
    body: JSON.stringify({ app: "kody-brain-own", machineId: "abc" }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.context.mockResolvedValue({
    ok: true,
    context: {
      account: "user-own",
      flyToken: "personal-only",
      githubToken: "",
      flyOrgSlug: "personal",
      flyDefaultRegion: "ams",
    },
  });
  mocks.overview.mockResolvedValue({
    service: { machine: { app: "kody-brain-own", machineId: "abc" } },
  });
  mocks.download.mockResolvedValue(new Response("archive"));
});
it("exports the signed-in account's Brain using its personal credential", async () => {
  expect((await POST(req())).status).toBe(200);
  expect(mocks.download).toHaveBeenCalledWith({
    app: "kody-brain-own",
    machineId: "abc",
    cfg: { token: "personal-only", orgSlug: "personal", defaultRegion: "ams" },
  });
});
it("never exports another account's Brain or another machine in the app", async () => {
  mocks.overview.mockResolvedValue({
    service: { machine: { app: "kody-brain-own", machineId: "other" } },
  });
  expect((await POST(req())).status).toBe(403);
  expect(mocks.download).not.toHaveBeenCalled();
});
it("requires a real signed-in Kody account", async () => {
  mocks.context.mockResolvedValue({
    ok: false,
    status: 401,
    error: "unauthorized",
  });
  expect((await POST(req())).status).toBe(401);
  expect(mocks.overview).not.toHaveBeenCalled();
});
