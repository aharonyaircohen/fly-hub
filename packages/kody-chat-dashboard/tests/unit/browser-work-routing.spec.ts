import { describe, expect, it } from "vitest";

import { buildToolIndex } from "../../src/dashboard/lib/chat-defaults";

import {
  isolateUserBrowserTurnTools,
  isUserBrowserCapabilityReadResult,
  isUserBrowserWorkRequest,
  selectUserBrowserActiveTools,
} from "../../app/api/kody/chat/kody/browser-work-routing";

describe("user browser work routing", () => {
  it.each([
    ["i want to use browser to post", undefined, true],
    ["Click Save in this website", undefined, true],
    [
      "post this text to fb",
      "[Live preview context]\n- Current URL: https://www.facebook.com/",
      true,
    ],
    ["What is the browser?", undefined, false],
    ["Configure my Facebook Page API connection", undefined, false],
    ["Open the Connections page", undefined, false],
  ])(
    "classifies %s without binding to one website",
    (userText, previewContext, expected) => {
      expect(isUserBrowserWorkRequest({ userText, previewContext })).toBe(
        expected,
      );
    },
  );
});

describe("user browser capability execution", () => {
  it("removes unrelated repository and specialist tools from a browser turn", () => {
    const tools = {
      list_capabilities: { name: "list" },
      read_capability: { name: "read" },
      browser_capability_act: { name: "act" },
      final_answer: { name: "answer" },
      github_search_code: { name: "search" },
      request_specialist_evidence: { name: "specialist" },
    };

    const isolated = isolateUserBrowserTurnTools(tools, true);

    expect(isolated).toEqual({
      list_capabilities: tools.list_capabilities,
      read_capability: tools.read_capability,
      browser_capability_act: tools.browser_capability_act,
      final_answer: tools.final_answer,
    });
    const toolIndex = buildToolIndex(isolated);
    expect(toolIndex).toContain("browser_capability_act");
    expect(toolIndex).not.toContain("github_search_code");
    expect(toolIndex).not.toContain("request_specialist_evidence");
  });

  it("preserves the complete toolset for non-browser turns", () => {
    const tools = {
      github_search_code: { name: "search" },
      final_answer: { name: "answer" },
    };

    expect(isolateUserBrowserTurnTools(tools, false)).toBe(tools);
  });

  it("recognizes a user-session browser capability read", () => {
    expect(
      isUserBrowserCapabilityReadResult({
        capability: {
          contract: JSON.stringify({
            execution: "agent",
            requirements: {
              browser: true,
              browserSession: "user",
              browserActions: ["navigate", "click", "fill"],
              browserOrigins: ["https://www.facebook.com"],
            },
            input: {},
            output: {},
          }),
        },
      }),
    ).toBe(true);
  });

  it.each([
    null,
    { found: false },
    { capability: { contract: "not-json" } },
    { capability: { contract: JSON.stringify({ execution: "agent" }) } },
  ])("rejects a non-browser capability read", (result) => {
    expect(isUserBrowserCapabilityReadResult(result)).toBe(false);
  });

  it.each([
    [
      "a browser request",
      {
        requested: true,
        continuation: false,
        capabilitiesListed: false,
        browserCapabilityRead: false,
      },
    ],
    [
      "a browser continuation",
      {
        requested: false,
        continuation: true,
        capabilitiesListed: true,
        browserCapabilityRead: true,
      },
    ],
  ])("keeps the complete scoped tool lane for %s", (_name, state) => {
    expect(
      selectUserBrowserActiveTools({
        ...state,
        availableTools: [
          "list_capabilities",
          "read_capability",
          "run_capability",
          "browser_capability_act",
          "preview_act",
          "final_answer",
        ],
      }),
    ).toEqual([
      "list_capabilities",
      "read_capability",
      "browser_capability_act",
      "final_answer",
    ]);
  });
});
