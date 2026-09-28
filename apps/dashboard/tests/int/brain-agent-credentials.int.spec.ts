import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  repository: vi.fn(),
  credential: vi.fn(),
  vault: vi.fn(),
}));
vi.mock("@dashboard/lib/brain/agent-access", () => ({
  requireBrainAgent: mocks.authenticate,
  requireAgentRepository: mocks.repository,
  agentError: (error: string, status: number) =>
    NextResponse.json({ error }, { status }),
  privateHeaders: { "Cache-Control": "no-store, max-age=0" },
}));
vi.mock("@kody-ade/brain/personal-services", () => ({
  getPersonalBrainServices: () => ({ getCredential: mocks.credential }),
}));
vi.mock("@kody-ade/base/vault/store", () => ({ readVault: mocks.vault }));
import { POST } from "../../app/api/kody/brain/agent/credentials/route";
const request = (body: unknown) =>
  new NextRequest("https://kody.example/api/kody/brain/agent/credentials", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.authenticate.mockResolvedValue({ userId: "alice" });
  mocks.credential.mockResolvedValue("personal-value");
  mocks.repository.mockResolvedValue({
    octokit: {},
    auth: { owner: "alice", repo: "project" },
  });
  mocks.vault.mockResolvedValue({
    doc: {
      secrets: {
        TEST_KEY: { value: "repo-value" },
        UNREQUESTED: { value: "hidden" },
      },
    },
  });
});
it("reads only named credentials for the authenticated machine owner", async () => {
  const response = await POST(request({ names: ["TEST_KEY"] }));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toEqual({
    values: { TEST_KEY: "personal-value" },
  });
  expect(mocks.credential).toHaveBeenCalledExactlyOnceWith("alice", "TEST_KEY");
});
it("checks project permissions before reading the vault and does not mix personal secrets", async () => {
  const response = await POST(
    request({ names: ["TEST_KEY"], repository: "alice/project" }),
  );
  expect(await response.json()).toEqual({ values: { TEST_KEY: "repo-value" } });
  expect(mocks.repository).toHaveBeenCalledWith(
    expect.anything(),
    "alice",
    "alice/project",
  );
  expect(mocks.credential).not.toHaveBeenCalled();
});
it("rejects another account field, internal credentials and bulk requests", async () => {
  expect(
    (await POST(request({ names: ["TEST_KEY"], userId: "bob" }))).status,
  ).toBe(400);
  expect((await POST(request({ names: ["KODY_SERVICE_KEY"] }))).status).toBe(
    403,
  );
  expect((await POST(request({ names: ["KODY_INTERNAL_TOKEN"] }))).status).toBe(
    403,
  );
  expect(
    (await POST(request({ names: Array(33).fill("TEST_KEY") }))).status,
  ).toBe(400);
  expect(mocks.credential).not.toHaveBeenCalled();
});
it("never reads secrets after rejected authentication or repository permission", async () => {
  mocks.authenticate.mockResolvedValueOnce(
    NextResponse.json({}, { status: 401 }),
  );
  expect((await POST(request({ names: ["TEST_KEY"] }))).status).toBe(401);
  mocks.repository.mockResolvedValueOnce(
    NextResponse.json({}, { status: 403 }),
  );
  expect(
    (await POST(request({ names: ["TEST_KEY"], repository: "bob/private" })))
      .status,
  ).toBe(403);
  expect(mocks.vault).not.toHaveBeenCalled();
  expect(mocks.credential).not.toHaveBeenCalled();
});
it("does not leak partial results or backend exceptions", async () => {
  mocks.credential.mockResolvedValueOnce(null);
  expect((await POST(request({ names: ["TEST_KEY"] }))).status).toBe(404);
  mocks.credential.mockRejectedValueOnce(new Error("secret-should-not-leak"));
  const response = await POST(request({ names: ["TEST_KEY"] }));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("secret-should-not-leak");
});
