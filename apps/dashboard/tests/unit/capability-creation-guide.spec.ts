import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { loadChatDefaults } from "../../src/dashboard/lib/chat-defaults";
import { DEFAULT_CHAT_CAPABILITY } from "../../src/dashboard/lib/chat-defaults/defaults";

const CAPABILITY_GUIDE = readFileSync("docs/capabilities.md", "utf8");
const CAPABILITY_TOOLS_SOURCE = readFileSync(
  "node_modules/@kody-ade/kody-chat-dashboard/app/api/kody/chat/tools/capability-tools.ts",
  "utf8",
);

describe("capability creation guide wiring", () => {
  it("documents the user-facing capability contract", () => {
    expect(CAPABILITY_GUIDE).toContain(
      "A Capability is one small executable method.",
    );
    expect(CAPABILITY_GUIDE).toContain("instructions.md");
    expect(CAPABILITY_GUIDE).toContain("contract.json");
    expect(CAPABILITY_GUIDE).toContain('execution');
    expect(CAPABILITY_GUIDE).toContain('"script"');
    expect(CAPABILITY_GUIDE).toContain('"agent"');
    expect(CAPABILITY_GUIDE).toContain("`secrets`");
    expect(CAPABILITY_GUIDE).toContain("`timeoutMs`");
    expect(CAPABILITY_GUIDE).toContain("`create_or_update_capability`");
    expect(CAPABILITY_GUIDE).not.toContain("Implementation");
  });

  it("exposes a guide tool before capability creation", () => {
    expect(CAPABILITY_TOOLS_SOURCE).toContain("read_capability_creation_guide");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("contract.json");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("execution:");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("secrets:");
    expect(DEFAULT_CHAT_CAPABILITY.tools).toContain(
      "read_capability_creation_guide",
    );
  });

  it("exposes a unified create-or-update tool", () => {
    expect(CAPABILITY_TOOLS_SOURCE).toContain("create_or_update_capability");
    expect(DEFAULT_CHAT_CAPABILITY.tools).toContain(
      "create_or_update_capability",
    );
    expect(DEFAULT_CHAT_CAPABILITY.tools).not.toContain(
      "create_or_update_executable",
    );
    expect(DEFAULT_CHAT_CAPABILITY.tools).not.toContain(
      "create_or_update_executable",
    );
  });

  it("delegates capability storage and execution to the Dashboard API", () => {
    expect(CAPABILITY_TOOLS_SOURCE).toContain("ctx.listCapabilities()");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("ctx.readCapability(slug)");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("ctx.saveCapability({");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("ctx.removeCapability(slug)");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("ctx.runCapability(slug)");
    expect(CAPABILITY_TOOLS_SOURCE).not.toContain("listLocalCapabilityFiles");
  });

  it("exposes the validated workflow creator instead of dashboard authoring", () => {
    expect(CAPABILITY_TOOLS_SOURCE).toContain("run_workflow_creator");
    expect(CAPABILITY_TOOLS_SOURCE).toContain('capability: "workflow-creator"');
    expect(DEFAULT_CHAT_CAPABILITY.tools).toContain("run_workflow_creator");
    expect(CAPABILITY_TOOLS_SOURCE).toContain("issue_number: String(issue)");
    expect(CAPABILITY_TOOLS_SOURCE).not.toContain("issue: String(issue)");
  });

  it("defaults Kody chat to the capability creation skill", async () => {
    const bundle = await loadChatDefaults("acme", "repo");
    const createCapability = bundle.skills["create-capability"];

    expect(createCapability).toBeDefined();
    expect(createCapability!.body).toContain(
      "`read_capability_creation_guide`",
    );
    expect(createCapability!.body).toContain("`create_or_update_capability`");
    expect(DEFAULT_CHAT_CAPABILITY.skills).toContain("create-capability");
    expect(DEFAULT_CHAT_CAPABILITY.skills).not.toContain(
      "create-implementation",
    );
  });
});
