import { describe, expect, it } from "vitest";

import { shouldRoutePublicAgentChat } from "../../app/api/kody/chat/kody/public-agent-routing";

const baseline = [
  ["What page am I viewing?", true],
  ["Summarize what is visible on this page.", true],
  ["What element did I select?", true],
  ["Where is the repository settings page?", false],
  ["Explain what a repository is in two sentences.", false],
  ["Create a new Agent for local workflow checks.", true],
  ["Run the draft-facebook-personal-post Capability.", true],
  ["Find why preview history loses the selected URL.", false],
  ["Review this page for accessibility problems.", true],
  ["Investigate why the latest CI run failed.", true],
  [
    "Review the preview implementation for UX, security, and operational risks.",
    true,
  ],
  ["Run a complete project assessment.", true],
] as const;

describe("current public Agent routing baseline", () => {
  it.each(baseline)(
    "records whether %s enters the specialist router",
    (userText, expected) => {
      expect(
        shouldRoutePublicAgentChat({
          userText,
          clientSurface: false,
          assignedSubagentCount: 5,
        }),
      ).toBe(expected);
    },
  );
});
