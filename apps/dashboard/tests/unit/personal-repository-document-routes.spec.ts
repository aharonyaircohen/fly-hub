import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  scope: vi.fn(async () => ({
    user: { id: "user-1", label: "Alice" },
    personalTenantId: "user:user-1",
  })),
  repoCommandsGet: vi.fn(async () =>
    Response.json({ commands: [{ slug: "repo-command", source: "repo" }] }),
  ),
  repoCommandsPost: vi.fn(async () => Response.json({ ok: true })),
  repoInstructionsGet: vi.fn(async () =>
    Response.json({ instructions: { body: "Repository rules" } }),
  ),
  repoInstructionsPut: vi.fn(async () => Response.json({ ok: true })),
  repoInstructionsDelete: vi.fn(async () => Response.json({ ok: true })),
  listPersonalCommands: vi.fn<
    () => Promise<Array<{ slug: string; source: "personal" }>>
  >(async () => []),
  readPersonalInstructions: vi.fn(async () => null),
}));

vi.mock("@dashboard/lib/auth/kody-request-scope", () => ({
  resolveKodyRequestScope: mocks.scope,
}));
vi.mock("@kody-ade/workspace/routes/commands", () => ({
  GET: mocks.repoCommandsGet,
  POST: mocks.repoCommandsPost,
}));
vi.mock("@kody-ade/workspace/routes/instructions", () => ({
  GET: mocks.repoInstructionsGet,
  PUT: mocks.repoInstructionsPut,
  DELETE: mocks.repoInstructionsDelete,
}));
vi.mock("@dashboard/lib/personal-documents", () => ({
  listPersonalCommands: mocks.listPersonalCommands,
  readPersonalCommand: vi.fn(async () => null),
  savePersonalCommand: vi.fn(),
  readPersonalInstructions: mocks.readPersonalInstructions,
  savePersonalInstructions: vi.fn(),
  removePersonalInstructions: vi.fn(),
}));

import {
  GET as getCommands,
  POST as postCommand,
} from "../../app/api/kody/commands/route";
import {
  DELETE as deleteInstructions,
  GET as getInstructions,
  PUT as putInstructions,
} from "../../app/api/kody/instructions/route";

function request(path: string, method = "GET", body?: unknown) {
  return new NextRequest(`https://dash.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "x-kody-owner": "acme",
      "x-kody-repo": "app",
      "x-kody-token": "token",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("personal and repository document routes", () => {
  it("keeps repository fallback commands out of personal commands", async () => {
    mocks.listPersonalCommands.mockResolvedValueOnce([
      { slug: "my-command", source: "personal" },
    ]);

    const response = await getCommands(
      new NextRequest("https://dash.test/api/kody/commands"),
    );

    expect(await response.json()).toEqual({
      commands: [{ slug: "my-command", source: "personal" }],
    });
  });

  it("keeps repository command reads and writes repository-owned", async () => {
    const getResponse = await getCommands(request("/api/kody/commands"));
    await postCommand(
      request("/api/kody/commands", "POST", {
        slug: "repo-command",
        body: "Do repository work",
      }),
    );

    expect(await getResponse.json()).toMatchObject({
      commands: [{ slug: "repo-command" }],
    });
    expect(mocks.listPersonalCommands).not.toHaveBeenCalled();
    expect(mocks.repoCommandsPost).toHaveBeenCalledOnce();
  });

  it("delegates every repository instructions operation", async () => {
    await getInstructions(request("/api/kody/instructions"));
    await putInstructions(
      request("/api/kody/instructions", "PUT", { body: "Repository rules" }),
    );
    await deleteInstructions(request("/api/kody/instructions", "DELETE"));

    expect(mocks.repoInstructionsGet).toHaveBeenCalledOnce();
    expect(mocks.repoInstructionsPut).toHaveBeenCalledOnce();
    expect(mocks.repoInstructionsDelete).toHaveBeenCalledOnce();
    expect(mocks.readPersonalInstructions).not.toHaveBeenCalled();
  });
});
