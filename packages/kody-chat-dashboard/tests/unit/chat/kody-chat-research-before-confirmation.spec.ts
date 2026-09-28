/**
 * Regression coverage for Kody Chat asking for confirmation before research.
 *
 * The desired behavior is: read/check/verify/analyze immediately, then ask
 * before state-changing actions such as creating issues, writing config, or
 * starting execution.
 *
 * @testFramework vitest
 * @domain unit
 */
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "../../../app/api/kody/chat/kody/system-prompt";
import {
  loadChatDefaults,
  composeBasePrompt,
} from "../../../src/dashboard/lib/chat-defaults";

describe("Kody chat confirmation boundary", () => {
  it("base prompt pre-authorizes research and reserves approval for actions", async () => {
    const prompt = composeBasePrompt(await loadChatDefaults("acme", "repo"));

    expect(prompt).toMatch(
      /Research, checking, verification, and analysis are pre-authorized/i,
    );
    expect(prompt).toMatch(
      /Do not ask before searching, reading, checking, verifying, analyzing, or comparing/i,
    );
    expect(prompt).toMatch(
      /Ask for confirmation only before state-changing actions/i,
    );
  });

  it("vibe prompt keeps approval after research and before issue creation", async () => {
    const prompt = buildSystemPrompt(
      composeBasePrompt(await loadChatDefaults("acme", "repo")),
      { owner: "acme", repo: "repo" },
      undefined,
      { vibeMode: true, flyConfigured: false },
    );

    expect(prompt).toMatch(
      /Do not ask for permission before research, checks, verification, or analysis/i,
    );
    expect(prompt).toMatch(/Ask for approval only before creating the issue/i);
  });
});
