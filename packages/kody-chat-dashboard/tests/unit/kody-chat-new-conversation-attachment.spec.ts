import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/KodyChat.tsx"),
  "utf8",
);

describe("new conversation attachments", () => {
  it("keeps the first attachment pending until conversation creation completes", () => {
    const addFiles = source.slice(
      source.indexOf("const addFiles = async"),
      source.indexOf("const removeAttachment"),
    );

    expect(addFiles).toContain(
      "const conversationId = sessionHook.activeSession?.id;",
    );
    expect(addFiles).toContain("if (!conversationId) createSelectedChatSession();");
    expect(addFiles).not.toContain(
      "sessionHook.activeSession?.id ?? createSelectedChatSession()",
    );
  });
});
