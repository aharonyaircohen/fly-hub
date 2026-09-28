/**
 * @fileoverview Integration coverage for the chat terminal stop route.
 * @testFramework vitest
 * @domain terminal
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  requireKodyAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(() => ({
    owner: "acme",
    repo: "widgets",
    token: "ghp_test",
  })),
}));

const localTerminal = vi.hoisted(() => ({
  stopLocalTerminalSession: vi.fn(() => true),
}));

vi.mock("@kody-ade/base/auth", () => auth);
vi.mock("@kody-ade/terminal/local-chat-session", () => localTerminal);

import { POST } from "../../app/api/kody/chat/terminal/stop/route";

function makeReq(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/terminal/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.requireKodyAuth.mockResolvedValue(null);
  auth.getRequestAuth.mockReturnValue({
    owner: "acme",
    repo: "widgets",
    token: "ghp_test",
  });
  localTerminal.stopLocalTerminalSession.mockReturnValue(true);
});

describe("POST /api/kody/chat/terminal/stop", () => {
  it("stops the authenticated terminal session", async () => {
    const res = await POST(makeReq({ sessionId: "terminal-chat-1" }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(localTerminal.stopLocalTerminalSession).toHaveBeenCalledWith(
      "terminal-chat-1",
      { owner: "acme", repo: "widgets", token: "ghp_test" },
    );
  });

  it("returns 400 when the repo context is missing", async () => {
    auth.getRequestAuth.mockReturnValue(null as never);

    const res = await POST(makeReq({ sessionId: "terminal-chat-1" }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "no_repo_context" });
    expect(localTerminal.stopLocalTerminalSession).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON bodies", async () => {
    const res = await POST(makeReq("{not json"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid_json" });
  });

  it("rejects bodies missing a sessionId", async () => {
    const res = await POST(makeReq({}));

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "validation_error" });
    expect(localTerminal.stopLocalTerminalSession).not.toHaveBeenCalled();
  });

  it("returns 404 when the terminal session does not exist", async () => {
    localTerminal.stopLocalTerminalSession.mockReturnValue(false);

    const res = await POST(makeReq({ sessionId: "gone" }));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "terminal_session_not_found",
    });
  });
});
