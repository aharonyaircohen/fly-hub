/**
 * Verifies chat-defaults bundle structure: agentIdentity, capability, workflows,
 * skills. Repo-backed capabilities/workflows are source truth; TS defaults are
 * fallback data.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "fs";
import {
  loadChatDefaults,
  composeChatPrompt,
  composeBasePrompt,
  buildToolIndex,
  CRITICAL_REMINDERS_MD,
} from "@dashboard/lib/chat-defaults";
import {
  DEFAULT_IDENTITY_MD,
  FOLLOW_UP_QUESTION_CONTRACT,
  DEFAULT_CHAT_CAPABILITY,
  DEFAULT_WORKFLOWS,
  DEFAULT_SKILLS,
} from "@dashboard/lib/chat-defaults/defaults";

describe("chat-defaults bundle", () => {
  it("loads repo-backed chat workflows when present, otherwise uses defaults", async () => {
    const bundle = await loadChatDefaults("acme", "widget");
    const capabilityPath = "legacy/capabilities/kody-chat/profile.json";
    const analyzerPath = "legacy/capabilities/kody-analyzer/profile.json";

    expect(bundle.capability.slug).toBe("kody-chat");
    if (existsSync(capabilityPath) && existsSync(analyzerPath)) {
      const capabilityProfile = JSON.parse(
        readFileSync(capabilityPath, "utf8"),
      );
      const analyzerProfile = JSON.parse(readFileSync(analyzerPath, "utf8"));
      expect(bundle.capability).toMatchObject(capabilityProfile);
      expect(
        bundle.workflows.find((workflow) => workflow.slug === "kody-analyzer"),
      ).toMatchObject({
        slug: analyzerProfile.slug ?? analyzerProfile.name ?? "kody-analyzer",
      });
    } else {
      expect(bundle.capability).toMatchObject(DEFAULT_CHAT_CAPABILITY);
    }
    expect(
      bundle.workflows.some((workflow) => workflow.slug === "kody-analyzer"),
    ).toBe(true);
    expect(bundle.skills["diagnose-pr"]?.body).toContain(
      'Triggers: "diagnose PR #N"',
    );
  });

  it("agentIdentity preserves the legacy AGENT_KODY.systemPrompt hard rules + tool policy (regression guard)", () => {
    // The agentIdentity text is now data, but the rules must not drift. The
    // chat-kody-direct integration tests assert the same invariants against
    // the bundle; this unit test pins the section boundaries so a future
    // refactor that drops # Hard rules or # Tool policy fails fast.
    expect(DEFAULT_IDENTITY_MD).toContain("# Hard rules");
    expect(DEFAULT_IDENTITY_MD).toContain("# Tool policy");
    // The legacy string's verbatim distinctive phrases (the ones the
    // model behavior depends on). The read-tool list is also pinned
    // here so a future refactor that adds a phantom tool name (one
    // that doesn't exist in the chat registry) fails this test.
    const phrases = [
      "Your prose must match the tool result",
      "injected context block",
      FOLLOW_UP_QUESTION_CONTRACT,
      "When no `## Current task` is present",
      "Execute selected issues without another approval",
      "github_search_code",
      "github_get_file",
      "github_list_tree",
      "github_blame",
      "github_commits_for_path",
      "github_get_pull_request",
      "No preambles",
      "Small factual answers",
    ];
    for (const p of phrases) {
      expect(DEFAULT_IDENTITY_MD).toContain(p);
    }
  });

  it("agentIdentity does not mention phantom tools (regression: phantom tools cause hallucinations)", () => {
    // The agentIdentity must only list tools that ACTUALLY exist in the
    // chat registry. Phantom names make the model attempt calls that
    // fail silently and then fabricate results to keep the user happy.
    const phantomTools = [
      "github_get_pull_request_files",
      "github_list_branches",
      "github_get_commit",
      "github_get_tree", // wrong name; registry has `github_list_tree`
    ];
    for (const t of phantomTools) {
      expect(DEFAULT_IDENTITY_MD).not.toContain(t);
    }
  });

  it("capability's tools list contains only names that exist in the chat registry", () => {
    // Every name in DEFAULT_CHAT_CAPABILITY.tools must match a tool the
    // route actually wires. If we add a name here that the registry
    // doesn't have, the model is told about a tool that doesn't
    // exist → it tries to call → call fails → it hallucinates. The
    // recent hallucination regression (do-not-invent-labels memory)
    // was caused by exactly this kind of phantom tool mention.
    const toolFiles = [
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/github-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/pipeline-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/kody-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/task-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/bug-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/agent-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/agent-admin-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/capability-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/cross-repository-capability-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/self-configuration-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/blueprint-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/workflow-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/agency-lifecycle-tools.ts",
      "node_modules/@kody-ade/workspace/src/tools/commands-tools.ts",
      "node_modules/@kody-ade/workspace/src/tools/context-tools.ts",
      "node_modules/@kody-ade/workspace/src/tools/todo-tools.ts",
      "node_modules/@kody-ade/workspace/src/tools/instructions-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/variables-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/secrets-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/models-tools.ts",
      "app/api/kody/chat/tools/reports-tools.ts",
      "app/api/kody/chat/tools/notifications-tools.ts",
      "app/api/kody/chat/tools/company-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/webhooks-tools.ts",
      "app/api/kody/chat/tools/inbox-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/release-tools.ts",
      "node_modules/@kody-ade/workspace/src/tools/memory-tools.ts",
      "app/api/kody/chat/tools/macros-tools.ts",
      "app/api/kody/chat/tools/remote-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/feature-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/ui-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/guided-flow-tools.ts",
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/fetch-url.ts",
    ];
    // Two registries: tools declared inline as `tool({` in a file
    // (the common shape), and tools grouped in a map like
    // `export const uiTools = { name: tool, ... }`. The map keys
    // are the model's tool names.
    const toolKeys = new Set<string>();
    for (const f of toolFiles) {
      const src = readFileSync(f, "utf8");
      // Inline: "  name: tool({"
      for (const m of src.matchAll(
        /^\s{2,8}([a-zA-Z_][a-zA-Z0-9_]*):\s*tool\(\{/gm,
      )) {
        toolKeys.add(m[1]);
      }
      // Map keys: "  name: variableName," inside an exported object.
      // The variable is a tool built with tool({…}) earlier in the file.
      // We accept any "key: identifier," pair inside an `export const` block.
      const mapBlocks = src.matchAll(
        /export\s+const\s+\w+\s*=\s*\{([\s\S]*?)\n\};/g,
      );
      for (const block of mapBlocks) {
        for (const m of block[1].matchAll(
          /^\s{2,8}([a-zA-Z_][a-zA-Z0-9_]*):\s*\w+,?\s*$/gm,
        )) {
          toolKeys.add(m[1]);
        }
      }
    }
    // Direct/factory-provided tools that are not discoverable by the simple
    // map-key regex above.
    toolKeys.add("fetch_url");
    for (const name of [
      "switch_agent",
      "dashboard_navigate",
      "preview_act",
      "show_view",
      "final_answer",
    ])
      toolKeys.add(name);
    for (const name of [
      "cms_list_collections",
      "cms_describe_collection",
      "cms_list_documents",
      "cms_get_document",
      "cms_mutate_document",
    ])
      toolKeys.add(name);
    for (const name of DEFAULT_CHAT_CAPABILITY.tools) {
      expect(
        toolKeys.has(name),
        `Tool "${name}" is in the capability's allowlist but not in any chat tool file. ` +
          "The model will be told it can call this tool but the call will fail. " +
          "Either implement the tool or remove it from the allowlist.",
      ).toBe(true);
    }
  });

  it("allowlists view tools so Kody can render chat UI", () => {
    expect(DEFAULT_CHAT_CAPABILITY.tools).toContain("final_answer");
    expect(DEFAULT_CHAT_CAPABILITY.tools).toContain("show_view");
  });

  it("documents show_view as spec-based rendering with strict validation", () => {
    const uiTools = readFileSync(
      "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/ui-tools.ts",
      "utf8",
    );
    expect(uiTools).toContain("Render an interactive UI card");
    expect(uiTools).toContain("do not print JSON");
    expect(uiTools).toContain("buildShowViewGuidance");
    expect(uiTools).toContain("validateChatViewSpec");
    expect(uiTools).toContain("fix the spec it describes and call again");
    expect(uiTools).toContain("Put only data that belongs");
    expect(uiTools).toContain(
      "do not copy preview, page, repo, task, memory, or research context",
    );
    // Guardrails against reintroducing the heuristic matcher.
    expect(uiTools).not.toContain("resolveBestViewRendererDefinition");
    expect(uiTools).not.toContain("purpose matches the request");
  });

  it("exposes 4 workflows — kody-analyzer, kody-operator, kody-vibe, kody-mem", () => {
    const slugs = DEFAULT_WORKFLOWS.map((d) => d.slug).sort();
    expect(slugs).toEqual([
      "kody-analyzer",
      "kody-mem",
      "kody-operator",
      "kody-vibe",
    ]);
  });

  it("groups the right skills under the right workflow", () => {
    const analyzer = DEFAULT_WORKFLOWS.find((d) => d.slug === "kody-analyzer");
    const operator = DEFAULT_WORKFLOWS.find((d) => d.slug === "kody-operator");
    const vibe = DEFAULT_WORKFLOWS.find((d) => d.slug === "kody-vibe");
    const mem = DEFAULT_WORKFLOWS.find((d) => d.slug === "kody-mem");

    expect(analyzer!.body).toContain("diagnose-pr");
    expect(analyzer!.body).toContain("read-agency-documentation");
    expect(analyzer!.body).toContain("report-advise");
    expect(analyzer!.body).toContain("todo-planner");

    expect(operator!.body).toContain("create-issue");
    expect(operator!.body).toContain("create-capability");
    expect(operator!.body).toContain("create-agent");

    expect(vibe!.body).toContain("vibe");
    expect(mem!.body).toContain("memory");
  });

  it("memory workflow treats explicit remember requests as write triggers", async () => {
    const bundle = await loadChatDefaults("acme", "widget");
    const trigger = 'Explicit memory command ("remember X"';

    expect(DEFAULT_SKILLS.memory.body).toContain(trigger);
    expect(
      DEFAULT_WORKFLOWS.find((d) => d.slug === "kody-mem")!.body,
    ).toContain("explicit memory command");
    expect(bundle.skills.memory.body).toContain(trigger);
    expect(
      bundle.workflows.find((workflow) => workflow.slug === "kody-mem")!.body,
    ).toContain("explicit memory command");
  });

  it("exposes the supported skills including self-configuration", () => {
    expect(Object.keys(DEFAULT_SKILLS).sort()).toEqual([
      "author-quality",
      "create-agent",
      "create-capability",
      "create-issue",
      "create-workflow",
      "diagnose-pr",
      "memory",
      "read-agency-documentation",
      "report-advise",
      "run-workflow",
      "self-configure",
      "todo-planner",
      "vibe",
    ]);
  });

  it("capability's skills array matches the keys of DEFAULT_SKILLS", () => {
    const skillSlugs = Object.keys(DEFAULT_SKILLS).sort();
    const execSkills = [...DEFAULT_CHAT_CAPABILITY.skills].sort();
    expect(execSkills).toEqual(skillSlugs);
  });

  it("capability's tools array is a flat list of names (no objects)", () => {
    for (const t of DEFAULT_CHAT_CAPABILITY.tools) {
      expect(typeof t).toBe("string");
    }
    expect(DEFAULT_CHAT_CAPABILITY.tools.length).toBeGreaterThan(0);
  });

  it("capability's tools list is deduped", () => {
    const seen = new Set(DEFAULT_CHAT_CAPABILITY.tools);
    expect(seen.size).toBe(DEFAULT_CHAT_CAPABILITY.tools.length);
  });

  it("capability exposes the workflow/pipeline status tools (regression: chat must recognize workflow status)", () => {
    // Regression guard — the chat used to lose these and started telling
    // users it had no access to workflow runs. If a future refactor drops
    // any of these, this test fails.
    const required = [
      "kody_get_pipeline_status",
      "kody_list_workflow_runs",
      "kody_list_open_prs",
    ];
    for (const t of required) {
      expect(DEFAULT_CHAT_CAPABILITY.tools).toContain(t);
    }
  });

  it("capability exposes todo-page management tools", () => {
    // Kody chat should manage the dashboard Todos page directly through
    // backend todo files, not redirect todo requests into GitHub issues.
    const required = [
      "list_todo_lists",
      "read_todo_list",
      "create_or_update_todo_list",
      "delete_todo_list",
    ];
    for (const t of required) {
      expect(DEFAULT_CHAT_CAPABILITY.tools).toContain(t);
    }
    expect(DEFAULT_IDENTITY_MD).toContain("use the todo tools directly");
    expect(DEFAULT_IDENTITY_MD).toContain("not GitHub issues");
  });

  it("capability's tool names match the chat registry naming (no camelCase drift)", () => {
    // Guard against future renames that don't update the bundle — known
    // drift: `remoteImplementation` vs registry's `remote_implementation`, old capability/implementation names
    // vs the real `read_capability_creation_guide`, etc.
    const known = new Set([
      "remote_read",
      "remote_ls",
      "read_capability_creation_guide",
    ]);
    for (const t of DEFAULT_CHAT_CAPABILITY.tools) {
      if (t.startsWith("remote") || t.includes("creation_guide")) {
        expect(known.has(t)).toBe(true);
      }
    }
  });
});

describe("composeChatPrompt", () => {
  it("joins agentIdentity, workflows, skills, and tools into a single prompt", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeChatPrompt(bundle, {
      repo: { owner: "acme", repo: "widget" },
    });
    // AgentIdentity header.
    expect(prompt).toContain("Kody — in-process dashboard chat agent");
    // Repo block.
    expect(prompt).toContain("## Connected repository");
    expect(prompt).toContain("acme/widget");
    // Todo namespace block.
    expect(prompt).toContain("## Todos");
    // Workflows header + all 4 workflows.
    expect(prompt).toContain("## Workflows");
    expect(prompt).toContain("### kody-analyzer");
    expect(prompt).toContain("### kody-operator");
    expect(prompt).toContain("### kody-vibe");
    expect(prompt).toContain("### kody-mem");
    // Skills header + all 8 skills.
    expect(prompt).toContain("## Skills");
    expect(prompt).toContain("### diagnose-pr");
    expect(prompt).toContain("### report-advise");
    expect(prompt).toContain("### todo-planner");
    expect(prompt).toContain("### create-issue");
    expect(prompt).toContain("### create-capability");
    expect(prompt).toContain("### create-agent");
    expect(prompt).toContain("### memory");
    // Tools allowlist.
    expect(prompt).toContain("## Tools available");
    expect(prompt).toContain("`github_search_code`");
    expect(prompt).toContain("`kody_run_issue`");
    expect(prompt).not.toContain("`remote_write`");
  });

  it("omits the Connected repository block when no repo is provided", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeChatPrompt(bundle, { repo: null });
    expect(prompt).not.toContain("## Connected repository");
    expect(prompt).not.toContain("## Todos");
  });

  it("appends the Current page block when currentPage is set", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeChatPrompt(bundle, {
      repo: { owner: "acme", repo: "widget" },
      currentPage: "the Variables page (/variables)",
    });
    expect(prompt).toContain("## Current page");
    expect(prompt).toContain("the Variables page (/variables)");
  });

  it("appends the Context block when context is set", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeChatPrompt(bundle, {
      repo: { owner: "acme", repo: "widget" },
      context: "### company-profile\n\nAcme builds widgets.",
    });
    expect(prompt).toContain("## Context — your default frame");
    expect(prompt).toContain("Acme builds widgets.");
  });

  it("appends the Remembered context block when memoryContext is set", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeChatPrompt(bundle, {
      repo: { owner: "acme", repo: "widget" },
      memoryContext: "- foo: bar",
    });
    expect(prompt).toContain("## Remembered context");
    expect(prompt).toContain("- foo: bar");
  });
});

describe("buildToolIndex", () => {
  it("formats each tool as `- `name` — description`", () => {
    const out = buildToolIndex({
      foo: { description: "Does the foo thing." },
      bar: { description: "Does the bar thing." },
    } as never);
    expect(out).toContain("- `foo` — Does the foo thing.");
    expect(out).toContain("- `bar` — Does the bar thing.");
  });

  it("truncates long descriptions to the first sentence or ~240 chars", () => {
    const long =
      "First sentence here. Second sentence that is way past the cap so it should be cut off at the first boundary.";
    const out = buildToolIndex({
      foo: { description: long },
    } as never);
    expect(out).toContain("First sentence here.");
    expect(out).not.toContain("Second sentence");
  });

  it("falls back to `- `name`` when a tool has no description", () => {
    const out = buildToolIndex({
      foo: { description: "" },
      bar: {},
    } as never);
    expect(out).toContain("- `foo`");
    expect(out).toContain("- `bar`");
  });
});

describe("composeBasePrompt toolIndex option", () => {
  it("includes a `## Tool index` block when toolIndex is provided", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeBasePrompt(bundle, {
      toolIndex: "- `github_search_code` — find candidate files",
    });
    expect(prompt).toContain("## Tool index");
    expect(prompt).toContain("`github_search_code` — find candidate files");
  });

  it("omits the Tool index block when toolIndex is not provided", async () => {
    const bundle = await loadChatDefaults();
    const prompt = composeBasePrompt(bundle);
    expect(prompt).not.toContain("## Tool index");
  });
});

describe("CRITICAL_REMINDERS_MD", () => {
  it("is a non-empty markdown string with the key reminders", () => {
    expect(typeof CRITICAL_REMINDERS_MD).toBe("string");
    expect(CRITICAL_REMINDERS_MD.length).toBeGreaterThan(100);
    expect(CRITICAL_REMINDERS_MD).toContain("## Critical reminders");
    expect(CRITICAL_REMINDERS_MD).toContain("Read repo before answering");
    expect(CRITICAL_REMINDERS_MD).toContain("Verify before claiming");
    expect(CRITICAL_REMINDERS_MD).toContain("No fabrication");
    expect(CRITICAL_REMINDERS_MD).toContain("CMS source truth");
    expect(CRITICAL_REMINDERS_MD).toContain("Content Entries");
    expect(CRITICAL_REMINDERS_MD).toContain("configured collection adapter");
    expect(CRITICAL_REMINDERS_MD).toContain("Cite your evidence");
    expect(CRITICAL_REMINDERS_MD).toContain("Contextual follow-up");
    expect(CRITICAL_REMINDERS_MD).toContain(FOLLOW_UP_QUESTION_CONTRACT);
    expect(CRITICAL_REMINDERS_MD).toContain("No sycophantic openers");
  });
});

describe("agentIdentity: verify-before-claiming rule", () => {
  it("agentIdentity contains a hard rule requiring verification before claiming", () => {
    // The do-not-invent-labels memory is a symptom of a missing hard
    // rule. The agentIdentity must have an explicit verify-before-claiming
    // rule so the model holds the line even when memory isn't read.
    expect(DEFAULT_IDENTITY_MD).toMatch(/verify before claiming/i);
    expect(DEFAULT_IDENTITY_MD).toMatch(/do not invent|inventing/i);
  });
});
