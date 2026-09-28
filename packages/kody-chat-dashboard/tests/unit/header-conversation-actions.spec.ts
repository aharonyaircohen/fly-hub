import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/chat/surface/HeaderControls.tsx"),
  "utf8",
);
const SETUP_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/lib/chat/surface/ChatSetupControl.tsx",
  ),
  "utf8",
);
const COMPOSER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/chat/surface/Composer.tsx"),
  "utf8",
);
const KODY_CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/KodyChat.tsx"),
  "utf8",
);
describe("chat conversation actions", () => {
  it("uses one setup menu while keeping every selection concept separate", () => {
    expect(SETUP_SOURCE).toContain('ariaLabel="Agency agent"');
    expect(SETUP_SOURCE).toContain('ariaLabel="Model"');
    expect(SETUP_SOURCE).toContain('ariaLabel="Effort"');
    expect(SETUP_SOURCE).toContain('ariaLabel="Machine"');
    expect(SETUP_SOURCE).toContain('aria-label="Chat setup"');
    expect(SETUP_SOURCE).toContain('data-testid="chat-setup-menu"');
    expect(SETUP_SOURCE).toContain("const agencyAgents");
    expect(SETUP_SOURCE).not.toContain(">Agent:</span>");
    expect(SETUP_SOURCE).not.toContain("agencyAgentControl");
    expect(SOURCE).not.toContain("const agencyAgentPicker");
    expect(SETUP_SOURCE).toContain("group.entries.map((entry) => (");
    expect(SETUP_SOURCE).toContain('label: "Built-in models"');
    expect(SETUP_SOURCE).toContain('label: "Your models"');
    expect(SETUP_SOURCE).toContain("Add chat model");
    expect(SOURCE).toContain("modelEntries={props.agentList}");
    expect(SOURCE).not.toContain("modelEntriesForMachineAccess(");
    expect(SOURCE).toContain("chatSetupControl");
    expect(COMPOSER_SOURCE).not.toContain("chatSettingsControl");
  });

  it("keeps all four selections visible in a two-row header trigger", () => {
    expect(SETUP_SOURCE).toContain('data-testid="chat-setup-primary"');
    expect(SETUP_SOURCE).toContain('data-testid="chat-setup-secondary"');
    expect(SETUP_SOURCE).toContain("selectedAgencyAgent.title");
    expect(SETUP_SOURCE).toContain("props.currentModelName");
    expect(SETUP_SOURCE).toContain("`${effortLabel} effort`");
    expect(SETUP_SOURCE).toContain('none: "No machine access"');
  });

  it("places the message count beside the chat title", () => {
    const headerRow = SOURCE.slice(
      SOURCE.indexOf('data-testid="chat-header-controls"'),
      SOURCE.indexOf('data-testid="chat-context-bar"'),
    );
    const titleRow = SOURCE.slice(
      SOURCE.indexOf('data-testid="chat-context-bar"'),
    );

    expect(titleRow).toContain("{messageCountBadge}");
    expect(headerRow).not.toContain("messageCount > 0");
  });

  it("shows the conversation title instead of capability or agent labels", () => {
    expect(SOURCE).toContain('data-testid="chat-context-title"');
    expect(SOURCE).toContain('props.activeSessionTitle ?? "New conversation"');
    expect(SOURCE).not.toContain("selectedCapability");
  });

  it("places new conversation and conversations in the header", () => {
    const conversationActions = SOURCE.slice(
      SOURCE.indexOf("const conversationActions"),
      SOURCE.indexOf("return (", SOURCE.indexOf("const conversationActions")),
    );
    const titleRow = SOURCE.slice(
      SOURCE.indexOf('data-testid="chat-context-bar"'),
    );
    const headerActions = SOURCE.slice(
      SOURCE.indexOf('data-testid="chat-header-controls"'),
      SOURCE.indexOf('data-testid="chat-context-bar"'),
    );

    expect(conversationActions).toContain('aria-label="New conversation"');
    expect(KODY_CHAT_SOURCE).toContain(
      "hideNewConversation={showSessionSidebar}",
    );
    expect(SOURCE).toContain("!props.hideNewConversation");
    expect(conversationActions).not.toContain("disabled={props.activeLoading}");
    expect(conversationActions).toContain('aria-label="Toggle conversations"');
    expect(conversationActions).toContain(
      "disabled={!props.sessionSidebarReady}",
    );
    expect(conversationActions).toContain(
      "aria-expanded={props.showSessionSidebar}",
    );
    expect(headerActions).toContain("{conversationActions}");
    expect(titleRow).not.toContain("{conversationActions}");
    expect(SOURCE).not.toContain("agencyAgentPicker");
  });

  it("closes each header dropdown on an outside pointer press", () => {
    expect(SOURCE).toContain(
      'document.addEventListener("pointerdown", closeMenuOutsideTarget)',
    );
    expect(SOURCE).toContain("setupMenuRef.current?.contains");
  });
});
