import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { DEFAULT_SKILL_MEMORY } from "../../../src/dashboard/lib/chat-defaults/defaults/skills-mem";
import { shouldRetryToollessTurn } from "../../../src/dashboard/lib/chat-output-tools";
import {
  CONVERSATION_ONLY_MEMORY_INSTRUCTION,
  hasExplicitMemoryCommand,
  hasActiveConversationOnlyMemoryScope,
  isConversationOnlyMemoryRequest,
} from "../../../src/dashboard/lib/memory-command-intent";

describe("explicit memory ownership", () => {
  it("keeps the memory tool as the only chat write owner", () => {
    const route = readFileSync(
      resolve(__dirname, "../../../app/api/kody/chat/kody/route.ts"),
      "utf8",
    );

    expect(route).not.toContain("buildExplicitMemoryDraft");
    expect(route).not.toContain("Explicit memory request already persisted");
  });

  it("defines language-independent scope and duplicate rules", () => {
    expect(DEFAULT_SKILL_MEMORY.body).toContain("in any language");
    expect(DEFAULT_SKILL_MEMORY.body).toContain(
      "Personal scope is only for information about the user",
    );
    expect(DEFAULT_SKILL_MEMORY.body).toContain(
      "Repository scope is for user-provided project context",
    );
    expect(DEFAULT_SKILL_MEMORY.body).toContain(
      "Do not proactively save repository facts that can be read from its files",
    );
    expect(DEFAULT_SKILL_MEMORY.body).toContain(
      "honor the request in repository scope",
    );
    expect(DEFAULT_SKILL_MEMORY.body).toContain(
      "Only confirm a write after the tool succeeds",
    );
    expect(DEFAULT_SKILL_MEMORY.body).toContain(
      "The `remember` tool checks for duplicates itself",
    );
    expect(DEFAULT_SKILL_MEMORY.body).toContain(
      "Do not call `recall_search` before `remember`",
    );
  });
});

describe("explicit memory command routing", () => {
  it.each([
    "Remember that my office is in Tel Aviv.",
    "Store this for later: I prefer short answers.",
    "תזכור שהצבע האהוב עליי הוא כחול",
  ])("recognizes a direct memory command: %s", (message) => {
    expect(hasExplicitMemoryCommand(message)).toBe(true);
  });

  it.each([
    "Do you remember where my office is?",
    "The save button is missing.",
    "Explain how memory storage works.",
    "Remember the marker ORBIT-7392 for this conversation.",
    "Please remember this only in the current chat.",
  ])("does not route a normal memory discussion as a write: %s", (message) => {
    expect(hasExplicitMemoryCommand(message)).toBe(false);
  });
});

describe("conversation-only memory routing", () => {
  it.each([
    "Remember the marker ORBIT-7392 for this conversation.",
    "What marker did I give you? Reply NONE if no marker was given in this conversation.",
  ])("keeps durable memory outside a conversation-only turn: %s", (message) => {
    expect(isConversationOnlyMemoryRequest(message)).toBe(true);
  });

  it("keeps durable memory available for an ordinary recall request", () => {
    expect(
      isConversationOnlyMemoryRequest("What do you remember about me?"),
    ).toBe(false);
  });

  it("tells the model to use transcript context without durable memory", () => {
    expect(CONVERSATION_ONLY_MEMORY_INSTRUCTION).toContain(
      "current conversation transcript",
    );
    expect(CONVERSATION_ONLY_MEMORY_INSTRUCTION).toContain(
      "Conversation-only context is automatic",
    );
    expect(CONVERSATION_ONLY_MEMORY_INSTRUCTION).toContain(
      "Do not call, require, or mention durable memory tools",
    );
  });

  it("carries conversation-only scope into later turns", () => {
    expect(
      hasActiveConversationOnlyMemoryScope([
        { role: "user", content: "Remember LIVE-9142 for this conversation." },
        { role: "assistant", content: "remembered" },
        { role: "user", content: "Reply with the marker only." },
      ]),
    ).toBe(true);
    expect(
      hasActiveConversationOnlyMemoryScope([
        { role: "user", content: "Remember LIVE-9142 for this conversation." },
        { role: "user", content: "Remember my office is in Tel Aviv." },
      ]),
    ).toBe(false);
  });
});

describe("tool-call enforcement", () => {
  it("retries visible prose when the provider claimed required tool support", () => {
    expect(
      shouldRetryToollessTurn({
        producedOutputTool: false,
        visibleAnswer: "fact-marker-only",
        enforceToolOutput: true,
        retryCount: 0,
        maxRetries: 2,
      }),
    ).toBe(true);
  });

  it("accepts visible prose from providers that do not support required tools", () => {
    expect(
      shouldRetryToollessTurn({
        producedOutputTool: false,
        visibleAnswer: "A normal answer",
        enforceToolOutput: false,
        retryCount: 0,
        maxRetries: 2,
      }),
    ).toBe(false);
  });

  it("never retries after a successful output tool", () => {
    expect(
      shouldRetryToollessTurn({
        producedOutputTool: true,
        visibleAnswer: "",
        enforceToolOutput: true,
        retryCount: 0,
        maxRetries: 2,
      }),
    ).toBe(false);
  });
});
