import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireKodyUser: vi.fn(),
  listHermesSessions: vi.fn(),
  createHermesSession: vi.fn(),
  getHermesSessionMessages: vi.fn(),
  getHermesSession: vi.fn(),
  deleteHermesSession: vi.fn(),
  updateHermesSession: vi.fn(),
  streamHermesTurn: vi.fn(),
  attachHermesFile: vi.fn(),
  getHermesModels: vi.fn(),
}));

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: mocks.requireKodyUser,
}));
vi.mock("@dashboard/lib/hermes/runtime", () => ({
  listHermesSessions: mocks.listHermesSessions,
  createHermesSession: mocks.createHermesSession,
  getHermesSessionMessages: mocks.getHermesSessionMessages,
  getHermesSession: mocks.getHermesSession,
  deleteHermesSession: mocks.deleteHermesSession,
  updateHermesSession: mocks.updateHermesSession,
  streamHermesTurn: mocks.streamHermesTurn,
  attachHermesFile: mocks.attachHermesFile,
  getHermesModels: mocks.getHermesModels,
}));

import { GET, POST } from "../../app/api/kody/hermes/sessions/route";
import {
  DELETE as deleteSession,
  GET as getSession,
  PATCH as patchSession,
} from "../../app/api/kody/hermes/sessions/[sessionId]/route";
import { POST as streamTurn } from "../../app/api/kody/hermes/sessions/[sessionId]/chat/stream/route";
import { POST as attachFile } from "../../app/api/kody/hermes/sessions/[sessionId]/attachments/route";
import { GET as getModels } from "../../app/api/kody/hermes/models/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireKodyUser.mockResolvedValue({ id: "user-1" });
  mocks.listHermesSessions.mockResolvedValue({ sessions: [] });
  mocks.createHermesSession.mockResolvedValue({
    session_id: "runtime-1",
    stored_session_id: "hermes-session-1",
  });
  mocks.getHermesSessionMessages.mockResolvedValue({ messages: [] });
  mocks.getHermesSession.mockResolvedValue({ id: "hermes-session-1" });
  mocks.deleteHermesSession.mockResolvedValue(undefined);
  mocks.updateHermesSession.mockResolvedValue(undefined);
  mocks.streamHermesTurn.mockResolvedValue(new Response("event: assistant.completed\ndata: {}\n\n", {
    headers: { "Content-Type": "text/event-stream" },
  }));
  mocks.attachHermesFile.mockResolvedValue({ ref_text: "@file:example" });
  mocks.getHermesModels.mockResolvedValue({ providers: [] });
});

describe("Hermes session routes", () => {
  it("requires a Kody account before listing Hermes sessions", async () => {
    mocks.requireKodyUser.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const response = await GET(new NextRequest("http://localhost/api/kody/hermes/sessions"));
    expect(response.status).toBe(401);
    expect(mocks.listHermesSessions).not.toHaveBeenCalled();
  });

  it("passes a bounded list size to Hermes", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/kody/hermes/sessions?limit=9999"),
    );
    expect(response.status).toBe(200);
    expect(mocks.listHermesSessions).toHaveBeenCalledWith(100, "kody-global");
  });

  it("creates a Hermes-owned session with the selected model and effort", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/kody/hermes/sessions", {
        method: "POST",
        body: JSON.stringify({
          title: "Planning",
          model: "provider/model",
          reasoningEffort: "high",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createHermesSession).toHaveBeenCalledWith({
      title: "Planning",
      model: "provider/model",
      reasoningEffort: "high",
      source: "kody-global",
    });
    await expect(response.json()).resolves.toMatchObject({
      id: "hermes-session-1", session_id: "runtime-1",
    });
  });

  it("rejects malformed session options before contacting Hermes", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/kody/hermes/sessions", {
        method: "POST",
        body: JSON.stringify({ model: 42 }),
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createHermesSession).not.toHaveBeenCalled();
  });

  it("reads session history from Hermes using the route session id", async () => {
    const response = await getSession(
      new NextRequest("http://localhost/api/kody/hermes/sessions/hermes-session-1"),
      { params: Promise.resolve({ sessionId: "hermes-session-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.getHermesSessionMessages).toHaveBeenCalledWith("hermes-session-1");
    expect(mocks.getHermesSession).toHaveBeenCalledWith("hermes-session-1");
  });

  it("deletes the Hermes-owned session after account authentication", async () => {
    const response = await deleteSession(
      new NextRequest("http://localhost/api/kody/hermes/sessions/hermes-session-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ sessionId: "hermes-session-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.deleteHermesSession).toHaveBeenCalledWith("hermes-session-1", undefined);
  });

  it("updates the title and pinned state in Hermes", async () => {
    const response = await patchSession(
      new NextRequest("http://localhost/api/kody/hermes/sessions/hermes-session-1", {
        method: "PATCH",
        body: JSON.stringify({ title: "Pinned chat", pinned: true }),
      }),
      { params: Promise.resolve({ sessionId: "hermes-session-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.updateHermesSession).toHaveBeenCalledWith("hermes-session-1", {
      title: "Pinned chat",
      pinned: true,
    }, undefined);
  });

  it("streams a new draft using its active Hermes id", async () => {
    const response = await streamTurn(
      new NextRequest("http://localhost/api/kody/hermes/sessions/hermes-session-1/chat/stream", {
        method: "POST",
        body: JSON.stringify({ message: "Hello", runtimeSessionId: "runtime-1" }),
      }),
      { params: Promise.resolve({ sessionId: "hermes-session-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.streamHermesTurn).toHaveBeenCalledWith(
      "hermes-session-1",
      { message: "Hello", runtimeSessionId: "runtime-1" },
      expect.any(AbortSignal),
      "runtime-1",
    );
    expect(mocks.createHermesSession).not.toHaveBeenCalled();
  });

  it("attaches to a new draft using its active Hermes id", async () => {
    const response = await attachFile(
      new NextRequest("http://localhost/api/kody/hermes/sessions/hermes-session-1/attachments", {
        method: "POST",
        body: JSON.stringify({ name: "notes.txt", dataUrl: "data:text/plain;base64,Zm9v", runtimeSessionId: "runtime-1" }),
      }),
      { params: Promise.resolve({ sessionId: "hermes-session-1" }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.attachHermesFile).toHaveBeenCalledWith("hermes-session-1", {
      name: "notes.txt", dataUrl: "data:text/plain;base64,Zm9v",
    }, "runtime-1");
    expect(mocks.createHermesSession).not.toHaveBeenCalled();
  });

  it("reads model choices from Hermes", async () => {
    const response = await getModels();
    expect(response.status).toBe(200);
    expect(mocks.getHermesModels).toHaveBeenCalledOnce();
  });
});
