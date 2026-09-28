/**
 * @fileoverview Integration tests for /api/kody/chat/kody (Kody direct agent).
 * @testFramework vitest
 * @domain chat-contract
 *
 * Covers request validation + provider-key plumbing without hitting the
 * live chat-model API. The SDK call is not mocked end-to-end; we assert the
 * behaviour the UI depends on: 400 on bad input, 409 + `fallback:
 * "kody-live"` when no model is resolvable or the key is missing (the UI
 * routes the turn through the Actions engine instead), auth gate before
 * doing any work.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const dashboardAuth = vi.hoisted(() => ({
  requireKodyUser: vi.fn<
    () => Promise<{ id: string; label: string } | NextResponse>
  >(async () => ({ id: "user-1", label: "Alice" })),
  query: vi.fn(async () => null),
}));

vi.mock("@dashboard/lib/auth/kody-user", () => ({
  requireKodyUser: dashboardAuth.requireKodyUser,
}));

vi.mock("@dashboard/lib/backend/convex-backend", () => ({
  backendApi: {
    userPreferences: { get: "userPreferences.get" },
    userCredentials: { get: "userCredentials.get" },
  },
  getConvexClient: () => ({ query: dashboardAuth.query }),
}));

vi.mock("@kody-ade/base/engine/config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@kody-ade/base/engine/config")>();
  return {
    ...actual,
    getEngineConfig: vi.fn(async () => ({
      config: { implementations: { default: "run" } },
      sha: null,
    })),
  };
});

vi.mock("@kody-ade/base/variables/load-chat-models", () => ({
  loadAutomaticModel: vi
    .fn()
    .mockResolvedValue({ default: false, engineDefault: false }),
  loadChatModels: vi.fn(async () => []),
}));

import { POST as kodyChatPOST } from "../../app/api/kody/chat/kody/route";
import { DEFAULT_MAX_STEPS } from "../../../../packages/kody-chat-dashboard/app/api/kody/chat/kody/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://dash.test/api/kody/chat/kody", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-kody-token": "ghp_test",
      "x-kody-owner": "owner",
      "x-kody-repo": "repo",
    },
    body: JSON.stringify(body),
  });
}

beforeAll(() => {
  // Auth requires this even though it's not directly used for the LLM call.
  process.env.KODY_MASTER_KEY = "kody-direct-test-secret";
});

afterEach(() => {
  vi.unstubAllEnvs();
  dashboardAuth.requireKodyUser.mockResolvedValue({
    id: "user-1",
    label: "Alice",
  });
  dashboardAuth.query.mockResolvedValue(null);
});

function disableEngineModelFallbackEnv() {
  vi.stubEnv("KODY_CHAT_MODEL", "");
  vi.stubEnv("KODY_ENGINE_MODEL", "");
  vi.stubEnv("E2E_CHAT_MODEL", "");
  vi.stubEnv("MINIMAX_API_KEY", "");
}

describe("POST /api/kody/chat/kody", () => {
  it("returns 409 with fallback:kody-live when no model can be resolved", async () => {
    disableEngineModelFallbackEnv();
    vi.stubEnv("MY_API_KEY", "");
    vi.stubEnv("CHAT_MODEL_API_KEY", "");
    const res = await kodyChatPOST(
      makeRequest({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.fallback).toBe("kody-live");
    // Surface either path: no models configured (empty LLM_MODELS) or
    // model resolved but its api-key secret is missing.
    expect(String(data.error)).toMatch(
      /no_models_configured|model_api_key_missing|model_base_url_missing/,
    );
  });

  it("returns 400 when messages are missing", async () => {
    vi.stubEnv("MY_API_KEY", "dummy-key");
    const res = await kodyChatPOST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.error)).toMatch(/messages required/);
  });

  it("returns 400 when messages array is empty", async () => {
    vi.stubEnv("MY_API_KEY", "dummy-key");
    const res = await kodyChatPOST(makeRequest({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when all messages have empty content (after filter)", async () => {
    vi.stubEnv("MY_API_KEY", "dummy-key");
    const res = await kodyChatPOST(
      makeRequest({
        messages: [
          { role: "user", content: "   " },
          { role: "assistant", content: "" },
        ],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 when kody auth is missing (no headers, no bot token)", async () => {
    vi.stubEnv("MY_API_KEY", "dummy-key");
    vi.stubEnv("KODY_BOT_TOKEN", "");
    const req = new NextRequest("https://dash.test/api/kody/chat/kody", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    dashboardAuth.requireKodyUser.mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
    const res = await kodyChatPOST(req);
    expect([401, 403]).toContain(res.status);
  });

  it("builds a system prompt that names the connected repo + task context", async () => {
    // We can't observe the system prompt the SDK sends without mocking the
    // provider, so we unit-test buildSystemPrompt by re-importing it.
    const { buildSystemPrompt } =
      await import("../../app/api/kody/chat/kody/system-prompt");
    const prompt = buildSystemPrompt(
      "You are Kody.",
      { owner: "acme", repo: "widgets" },
      {
        issueNumber: 42,
        title: "Add dark mode",
        state: "open",
        labels: ["ui", "good-first-issue"],
        associatedPR: {
          number: 101,
          state: "open",
          html_url: "https://github.com/acme/widgets/pull/101",
        },
      },
    );
    expect(prompt).toContain("acme/widgets");
    expect(prompt).toContain("Issue #42");
    expect(prompt).toContain("Add dark mode");
    expect(prompt).toContain("ui, good-first-issue");
    expect(prompt).toContain("Associated PR: #101");
  });

  it("builds a repo-less prompt when no auth headers are present", async () => {
    const { buildSystemPrompt } =
      await import("../../app/api/kody/chat/kody/system-prompt");
    const prompt = buildSystemPrompt("base", null, undefined);
    expect(prompt).toContain("base");
    expect(prompt).toContain("## Generic view rendering");
    expect(prompt).not.toContain("## Connected repository");
  });

  it("allows explicit issue execution handoff in vibe mode", async () => {
    const { buildSystemPrompt } =
      await import("../../app/api/kody/chat/kody/system-prompt");
    const prompt = buildSystemPrompt(
      "base",
      { owner: "acme", repo: "app" },
      {
        issueNumber: 776,
        title: "Keep logo colors in dark mode",
        state: "open",
      },
      { vibeMode: true },
    );

    expect(prompt).toContain("explicit issue handoff");
    expect(prompt).toContain("call `kody_run_issue` for the current issue");
    expect(prompt).toContain("Do not tell the user to post `@kody` manually");
    expect(prompt).not.toContain("Kody chat opens issues only");
  });

  it("treats preview make-page requests as issue-creation requests", async () => {
    const { buildSystemPrompt } =
      await import("../../app/api/kody/chat/kody/system-prompt");
    const prompt = buildSystemPrompt(
      "base",
      { owner: "acme", repo: "app" },
      undefined,
      {
        previewContext:
          "[Preview context]\n- Source path: views/demo-123\n- Preview URL: /api/kody/views/demo-123/index.html",
      },
    );

    expect(prompt).toContain("## Current preview reference");
    expect(prompt).toContain('"make this page"');
    expect(prompt).toContain("create a GitHub issue");
    expect(prompt).toContain("Do not answer with a fresh design direction");
    expect(prompt).toContain("Source path: views/demo-123");
  });

  it("appends a current-capability block when opts.capability is set", async () => {
    const { buildSystemPrompt } =
      await import("../../app/api/kody/chat/kody/system-prompt");
    const prompt = buildSystemPrompt("base", null, undefined, {
      capability: {
        number: 7,
        title: "Auto-triage stale issues",
        body: "## Intent\nClose stale issues",
        state: "open",
        labels: ["kody:capability"],
      },
    });
    expect(prompt).toContain("Current capability");
    expect(prompt).toContain("Capability #7");
    expect(prompt).toContain("Auto-triage stale issues");
    expect(prompt).toContain("Close stale issues");
    expect(prompt).toContain("kody:capability");
  });

  it("base kody prompt tells the model to read injected context blocks before answering", async () => {
    // Regression: model used to ignore ## Current task / Current capability /
    // Current page / Remembered context blocks and answer as if it
    // were a fresh session. Hard rule #2 now explicitly grounds answers
    // in those blocks. Prompt lives in the chat-defaults bundle agentIdentity.
    const { loadChatDefaults } =
      await import("../../src/dashboard/lib/chat-defaults");
    const prompt = (await loadChatDefaults("acme", "repo")).agentIdentity;
    expect(prompt).toMatch(/injected context block/i);
    expect(prompt).toMatch(/do NOT re-ask for facts the block already states/i);
    expect(prompt).toContain("## Current task");
    expect(prompt).toContain("## Current capability");
    expect(prompt).toContain("## Current report");
    expect(prompt).toContain("## Current page");
    expect(prompt).toContain("## Remembered context");
  });

  it("base kody prompt requires prose to match the tool result, with 'my read:' for inferences", async () => {
    // Regression: model used to read a tool result and then write a
    // confident summary that drifted. Hard rule #1 now requires the
    // prose to match the tool result and to prefix inferences. Prompt
    // lives in the chat-defaults bundle agentIdentity.
    const { loadChatDefaults } =
      await import("../../src/dashboard/lib/chat-defaults");
    const prompt = (await loadChatDefaults("acme", "repo")).agentIdentity;
    expect(prompt).toMatch(/Your prose must match the tool result/i);
    expect(prompt).toContain("my read:");
  });

  it("base kody prompt gives self-contained direction and bans sycophantic openers", async () => {
    // Regression: model used to close replies with no follow-up and start
    // with "Great question!" / "Sure!". The prompt now asks for direction
    // on non-trivial replies while still banning sycophantic openers.
    const { loadChatDefaults } =
      await import("../../src/dashboard/lib/chat-defaults");
    const prompt = (await loadChatDefaults("acme", "repo")).agentIdentity;
    expect(prompt).toMatch(/self-contained follow-up question/i);
    expect(prompt).toMatch(/name the subject and current result/i);
    expect(prompt).toMatch(/exact next decision or action/i);
    expect(prompt).not.toMatch(/This applies to EVERY reply/i);
    for (const banned of [
      "Great question",
      "Sure!",
      "Of course",
      "Absolutely",
      "Happy to help",
      "Certainly",
      "I'd be glad to",
      "Thanks for asking",
      "Good catch",
    ]) {
      expect(prompt).toContain(banned);
    }
    expect(prompt).toMatch(/Never start with sycophancy/i);
  });

  it("fallback kody prompt mirrors the answer-first contract", async () => {
    const { DEFAULT_IDENTITY_MD } =
      await import("../../src/dashboard/lib/chat-defaults/defaults");

    expect(DEFAULT_IDENTITY_MD).toMatch(/Kody reply contract/i);
    expect(DEFAULT_IDENTITY_MD).toMatch(/Final replies start with one plain/i);
    expect(DEFAULT_IDENTITY_MD).toMatch(
      /Progress lines are not final answers/i,
    );
    expect(DEFAULT_IDENTITY_MD).not.toMatch(/Emit a status line/i);
    expect(DEFAULT_IDENTITY_MD).not.toMatch(/This applies to EVERY reply/i);
  });

  it("critical reminders preserve answer-first style while enforcing safety", async () => {
    const { CRITICAL_REMINDERS_MD } =
      await import("../../src/dashboard/lib/chat-defaults");

    expect(CRITICAL_REMINDERS_MD).toMatch(/Start with the answer/i);
    expect(CRITICAL_REMINDERS_MD).toMatch(/Verify before claiming/i);
    expect(CRITICAL_REMINDERS_MD).toMatch(/Contextual follow-up/i);
    expect(CRITICAL_REMINDERS_MD).toMatch(
      /name the subject and current result/i,
    );
    expect(CRITICAL_REMINDERS_MD).not.toMatch(/Re-state last thing you read/i);
    expect(CRITICAL_REMINDERS_MD).not.toMatch(/Every reply ends/i);
  });

  it("vibe prompt keeps Kody chat out of direct runner handoff", async () => {
    const { buildSystemPrompt } =
      await import("../../app/api/kody/chat/kody/system-prompt");

    const prompt = buildSystemPrompt(
      "base",
      { owner: "acme", repo: "repo" },
      undefined,
      { vibeMode: true, flyConfigured: true },
    );

    expect(prompt).toMatch(/Stop after issue creation/i);
    expect(prompt).toMatch(/explicit issue handoff/i);
    expect(prompt).toMatch(/The only execution handoff allowed/i);
    expect(prompt).toContain("kody_run_issue");
    expect(prompt).not.toContain("Kody chat opens issues only");
    expect(prompt).not.toContain("targetAgent");
  });

  it("base kody prompt executes explicitly approved selected issues and enumerates the full read-tool catalog", async () => {
    // With no current task, implementation language starts the issue workflow.
    // With a selected current task, explicit execution language must dispatch
    // that issue immediately without another approval round. Also: the agentIdentity's
    // read-tools list must match the chat registry's actual tool names —
    // phantom tools in the prompt cause the model to call non-existent
    // tools and hallucinate the result. Prompt lives in the chat-defaults
    // bundle agentIdentity.
    const { loadChatDefaults } =
      await import("../../src/dashboard/lib/chat-defaults");
    const prompt = (await loadChatDefaults("acme", "repo")).agentIdentity;
    expect(prompt).toMatch(/When no `## Current task` is present/i);
    expect(prompt).toMatch(/create or refine an issue/i);
    expect(prompt).toMatch(/When a `## Current task` is present/i);
    expect(prompt).toMatch(/call `kody_run_issue` in that turn/i);
    expect(prompt).toMatch(/Do not ask for another approval/i);
    // The 4 read tools the model must know it can call.
    expect(prompt).toContain("github_search_code");
    expect(prompt).toContain("github_get_file");
    expect(prompt).toContain("github_list_tree");
    expect(prompt).toContain("github_blame");
    expect(prompt).toContain("github_commits_for_path");
    expect(prompt).toContain("github_get_pull_request");
  });

  it("base kody prompt memory section lists every tool and explicit-write rules", async () => {
    // The memory section lists every memory tool and requires explicit
    // requests to produce one write without duplicating an existing entry.
    // The memory section lives in the `memory` skill of the chat-defaults
    // bundle (extracted out of the agentIdentity).
    const { loadChatDefaults } =
      await import("../../src/dashboard/lib/chat-defaults");
    const bundle = await loadChatDefaults("acme", "repo");
    const prompt = `${bundle.agentIdentity}\n${Object.values(bundle.skills)
      .map((s) => s.body)
      .join("\n")}`;
    expect(prompt).toMatch(/recall_search/);
    expect(prompt).toMatch(/list_memories/);
    expect(prompt).toMatch(/update_memory/);
    expect(prompt).toMatch(
      /in any language → call `remember` directly and exactly once/i,
    );
    expect(prompt).toMatch(/`remember` tool checks for duplicates itself/i);
    expect(prompt).not.toMatch(
      /until 5\+ memories exist, write only on explicit ask/i,
    );
  });

  it("DEFAULT_MAX_STEPS is 100 (optimized for deep analysis)", () => {
    // Regression: the cap used to vary by context. The
    // prompt's "no fixed budget" rule needs a generous ceiling to mean
    // anything. 100 covers real research loops; maxDuration still bounds
    // wall-clock.
    expect(DEFAULT_MAX_STEPS).toBe(100);
  });
});
