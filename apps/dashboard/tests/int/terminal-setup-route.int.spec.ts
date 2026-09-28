import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { setPersonalBrainServices } from "@kody-ade/brain/personal-services";

let signedIn = true;

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async (): Promise<Response | null> => null),
}));
const context = vi.hoisted(() => ({
  resolveServerProviderContext: vi.fn(async () => ({
    ok: true,
    context: {
      owner: "acme",
      repo: "widgets",
      account: "octocat",
      githubToken: "gh-token",
      flyToken: "fly-token",
      flyOrgSlug: "personal",
      flyDefaultRegion: "fra",
    },
  })),
}));
const commands = vi.hoisted(() => ({
  manageBrainServer: vi.fn(async () => ({
    ok: true,
    app: "kody-brain-octocat",
    machineId: "brain-new",
    bridgeApp: "kody-terminal",
  })),
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@kody-ade/fly/infrastructure/server-context", () => context);
vi.mock("@kody-ade/brain/server-commands", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@kody-ade/brain/server-commands")>();
  return { ...original, manageBrainServer: commands.manageBrainServer };
});

import { POST } from "../../app/api/kody/terminal/setup/route";

describe("POST /api/kody/terminal/setup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedIn = true;
    setPersonalBrainServices({
      resolveUser: async () =>
        signedIn ? { id: "user-1", label: "Octocat" } : null,
      getCredential: async () => null,
      getCredentials: async () => ({ FLY_API_TOKEN: "fly-token" }),
      loadState: async () => null,
      saveState: async () => undefined,
    });
  });

  it("requires auth before changing a Brain runtime", async () => {
    signedIn = false;

    const response = await POST(
      new NextRequest("https://dash.test/api/kody/terminal/setup", {
        method: "POST",
        body: JSON.stringify({ reason: "terminal_gateway_not_ready" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(commands.manageBrainServer).not.toHaveBeenCalled();
  });

  it("runs the explicit terminal setup command for the signed-in user", async () => {
    const response = await POST(
      new NextRequest("https://dash.test/api/kody/terminal/setup", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      machineId: "brain-new",
      bridgeApp: "kody-terminal",
    });
    expect(commands.manageBrainServer).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "setup-terminal",
        replaceExistingMachine: false,
        context: expect.objectContaining({ userId: "user-1" }),
      }),
    );
  });

  it("requests Brain replacement only for a missing terminal agent", async () => {
    await POST(
      new NextRequest("https://dash.test/api/kody/terminal/setup", {
        method: "POST",
        body: JSON.stringify({ reason: "terminal_agent_missing" }),
      }),
    );

    expect(commands.manageBrainServer).toHaveBeenCalledWith(
      expect.objectContaining({ replaceExistingMachine: true }),
    );
  });
});
