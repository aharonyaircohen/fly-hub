import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sendSource = readFileSync(
  resolve(__dirname, "../../../src/dashboard/lib/components/kody-chat-send.ts"),
  "utf8",
);
const messageListSource = readFileSync(
  resolve(__dirname, "../../../src/dashboard/lib/chat/surface/MessageList.tsx"),
  "utf8",
);
const sessionSource = readFileSync(
  resolve(
    __dirname,
    "../../../src/dashboard/lib/chat/core/conversation/use-conversation-sessions.ts",
  ),
  "utf8",
);
const routeSource = readFileSync(
  resolve(__dirname, "../../../app/api/kody/chat/kody/route.ts"),
  "utf8",
);

describe("automatic compaction integration", () => {
  it("stores compact memory separately from the visible transcript", () => {
    expect(sessionSource).toContain("setSessionCheckpoint");
    expect(sessionSource).toContain("contextCheckpoint: checkpoint");
    expect(sessionSource).toContain(
      "conversationClient.command(sessionId,",
    );
  });

  it("sends chat turns to Hermes, which owns context compaction", () => {
    expect(sendSource).toContain("/api/kody/hermes/sessions/");
    expect(sendSource).not.toContain("conversationSummary: conversationContext.summary");
  });

  it("shows accessible progress without adding a transcript message", () => {
    expect(messageListSource).toContain('role="status"');
    expect(messageListSource).toContain("Compacting conversation…");
    expect(messageListSource).toContain("Conversation compacted");
  });

  it("does not apply the old 50-message fallback after compact memory exists", () => {
    expect(routeSource).toMatch(
      /body\.conversationSummary\s*\?\s*allMessages\s*:\s*trimToRecent\(allMessages\)/,
    );
  });
});
