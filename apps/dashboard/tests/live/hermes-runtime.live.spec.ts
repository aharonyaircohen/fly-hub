import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const enabled = process.env.HERMES_RUNTIME_LIVE === "1";
const createdIds: string[] = [];

describe.skipIf(!enabled)("local Hermes runtime", () => {
  afterAll(async () => {
    const { deleteHermesSession } = await import("../../src/dashboard/lib/hermes/runtime");
    await Promise.all(createdIds.map((id) => deleteHermesSession(id)));
  });

  it("creates a session and streams a real reply", async () => {
    const {
      createHermesSession,
      deleteHermesSession,
      getHermesSession,
      getHermesSessionMessages,
      getHermesModels,
      listHermesSessions,
      attachHermesFile,
    } = await import("../../src/dashboard/lib/hermes/runtime");
    const listed = await listHermesSessions(5, "kody-global");
    expect(Array.isArray(listed.sessions)).toBe(true);

    const created = await createHermesSession({
      title: "Kody local Hermes check",
      source: "kody-global",
    });
    const sessionId = String(created.stored_session_id ?? "");
    const runtimeSessionId = String(created.session_id ?? "");
    expect(sessionId).toBeTruthy();
    expect(runtimeSessionId).toBeTruthy();

    const models = await getHermesModels() as { provider?: string; model?: string };
    expect(models.provider).toBeTruthy();
    expect(models.model).toBeTruthy();
    const attachment = await attachHermesFile(sessionId, {
      name: "kody-check.txt",
      dataUrl: "data:text/plain;base64,aGVybWVzIGF0dGFjaG1lbnQgY2hlY2s=",
    }, runtimeSessionId);
    expect(attachment.ref_text).toContain("@file:");

    const { streamHermesTurn } = await import("../../src/dashboard/lib/hermes/runtime");
    const stream = await streamHermesTurn(sessionId, {
      message: `Reply with only the word ready.\n\n${attachment.ref_text}`,
      model: `${models.provider}/${models.model}`,
      model_options: { reasoning_effort: "low" },
    }, AbortSignal.timeout(45_000), runtimeSessionId);
    const events = await stream.text();
    expect(events).toContain("event: assistant.completed");
    createdIds.push(sessionId);

    const [session, history] = await Promise.all([
      getHermesSession(sessionId),
      getHermesSessionMessages(sessionId),
    ]);
    expect(session.id).toBe(sessionId);
    expect(history).toMatchObject({ session_id: sessionId });
    const messages = (history as { messages?: Array<{ role?: string; content?: string }> }).messages;
    expect(messages?.some((message) => message.role === "user" && message.content?.includes("ready"))).toBe(true);
    expect(messages?.some((message) => message.role === "assistant")).toBe(true);
    const recent = await listHermesSessions(100, "kody-global");
    expect(recent.sessions.some((entry) => entry.id === sessionId)).toBe(true);

    await deleteHermesSession(sessionId);
    createdIds.splice(createdIds.indexOf(sessionId), 1);
  }, 180_000);

  it("renames and deletes an empty draft", async () => {
    const {
      createHermesSession, updateHermesSession,
      getHermesSession, deleteHermesSession,
    } = await import("../../src/dashboard/lib/hermes/runtime");
    const created = await createHermesSession({ source: "kody-global" });
    const storedId = String(created.stored_session_id ?? "");
    const runtimeId = String(created.session_id ?? "");
    expect(storedId).toBeTruthy();
    expect(runtimeId).toBeTruthy();
    createdIds.push(storedId);
    await updateHermesSession(storedId, { title: "Renamed draft", pinned: true }, runtimeId);
    expect(await getHermesSession(storedId)).toMatchObject({ title: "Renamed draft" });
    await deleteHermesSession(storedId, runtimeId);
    createdIds.splice(createdIds.indexOf(storedId), 1);
  }, 30_000);
});
