export const LIVE_UI_JOURNEYS = Object.freeze([
  {
    id: "loops-real-persistence",
    file: "tests/e2e/loops-real-persistence.e2e.spec.ts",
    title: "refreshing real Loops preserves task monitoring and its deadline",
  },
  {
    id: "repository-secrets-real-persistence",
    file: "tests/e2e/repository-secrets-real.e2e.spec.ts",
    title: "saves, reloads, reveals, and deletes a real repository secret",
  },
  {
    id: "activity-agents-real",
    file: "tests/e2e/activity-agents-real.e2e.spec.ts",
    title: "shows inspectable MCP runs, calls, work, approvals, and execution",
  },
  {
    id: "memory-real-lifecycle",
    file: "tests/e2e/memory-real.e2e.spec.ts",
    title:
      "creates, revises, reloads, and deletes typed memory through real Convex persistence",
  },
  {
    id: "memory-real-model-journeys",
    file: "tests/e2e/memory-llm-real.e2e.spec.ts",
    title:
      "uses a real model for all memory kinds, scopes, retrieval, listing, correction history, and forgetting",
  },
  {
    id: "file-manager-real-mutations",
    file: "tests/e2e/file-manager-real.e2e.spec.ts",
    title: "creates, moves, deletes, and cleans up real repository files",
  },
  {
    id: "agent-guidance-real-persistence",
    file: "tests/e2e/agent-guidance-real.e2e.spec.ts",
    title: "creates, persists, and deletes real agent constraints and policies",
  },
  {
    id: "live-agent-real-cycle",
    file: "tests/e2e/live-agent-real.e2e.spec.ts",
    title:
      "makes a real Agent live, executes one cycle, and shows its persisted activity",
  },
  {
    id: "direct-kody-chat",
    file: "tests/e2e/direct-chat-real.e2e.spec.ts",
    title:
      "sends a real direct-model turn, persists it, and restores it after reload",
  },
  {
    id: "engine-chat-visible-reply",
    file: "tests/e2e/chat-real-system.spec.ts",
    title: "UI send → engine reply committed to target repo within 2 min",
  },
  {
    id: "ci-repair-chat-to-engine",
    file: "tests/e2e/ci-repair-chat-real.e2e.spec.ts",
    title: "runs healthy main-branch CI without requiring a PR",
  },
  {
    id: "brain-terminal-live-input",
    file: "tests/e2e/chat-terminal-live-ui.spec.ts",
    title:
      "selects Brain, keeps xterm visible, and accepts input after the stall window",
  },
  {
    id: "brain-runtime-lifecycle",
    file: "tests/e2e/brain-runtime-lifecycle-live.e2e.spec.ts",
    title:
      "saves, destroys, restores, reconnects, and reads persistent Brain terminal state",
  },
  {
    id: "guided-flows-real-definitions",
    file: "tests/e2e/guided-flows-real.e2e.spec.ts",
    title: "loads real Guided Flow definitions",
  },
  {
    id: "guided-flows-real-persistence",
    file: "tests/e2e/guided-flows-real.e2e.spec.ts",
    title: "creates, completes, persists, and cleans up a real custom flow",
  },
  {
    id: "guided-flows-real-chat-context",
    file: "tests/e2e/guided-flows-real.e2e.spec.ts",
    title:
      "uses real Chat to read the current Guided Flow step and submitted answer",
  },
  {
    id: "vibe-real-execution",
    file: "tests/e2e/vibe-live-full-flow.spec.ts",
    title: "rename welcome text → approve → runner pushes the real diff",
  },
  {
    id: "view-renderers-real-data",
    file: "tests/e2e/view-renderers-real.e2e.spec.ts",
    title: "shows built-in renderers in the real management page",
  },
  {
    id: "authentication-and-repository-selection",
    file: "tests/e2e/master-journeys-real.e2e.spec.ts",
    title:
      "connects a real repository and restores the authenticated selection",
  },
  {
    id: "brain-chat",
    file: "tests/e2e/chat-terminal-live-ui.spec.ts",
    title: "sends a real Brain chat turn and shows the reply",
  },
  {
    id: "conversation-persistence",
    file: "tests/e2e/direct-chat-real.e2e.spec.ts",
    title:
      "sends a real direct-model turn, persists it, and restores it after reload",
  },
  {
    id: "attachments",
    file: "tests/e2e/direct-chat-real.e2e.spec.ts",
    title:
      "sends a real direct-model turn, persists it, and restores it after reload",
  },
  {
    id: "rendered-views-and-approvals",
    file: "tests/e2e/vibe-live-full-flow.spec.ts",
    title: "rename welcome text → approve → runner pushes the real diff",
  },
  {
    id: "views-real-fly-browser",
    file: "tests/e2e/views-real-browser-live.e2e.spec.ts",
    title: "runs Fly actions, switches saved views, and opens a Dashboard task",
  },
  {
    id: "commands-and-context",
    file: "tests/e2e/master-journeys-real.e2e.spec.ts",
    title: "fully loads the extracted admin pages",
  },
  {
    id: "agent-and-model-selection",
    file: "tests/e2e/vibe-live-full-flow.spec.ts",
    title: "rename welcome text → approve → runner pushes the real diff",
  },
  {
    id: "client-branded-chat",
    file: "tests/e2e/master-journeys-real.e2e.spec.ts",
    title: "uses the real branded client chat and restores its reply",
  },
  {
    id: "navigation-and-plugin-panels",
    file: "tests/e2e/master-journeys-real.e2e.spec.ts",
    title: "fully loads the extracted admin pages",
  },
  {
    id: "mobile",
    file: "tests/e2e/master-journeys-real.e2e.spec.ts",
    title: "keeps the real client chat usable on mobile",
  },
]);

export const LIVE_UI_SPECS = Object.freeze([
  ...new Set(LIVE_UI_JOURNEYS.map((journey) => journey.file)),
]);

export const EXPECTED_LIVE_UI_TESTS = LIVE_UI_JOURNEYS.length;

// Required product journeys that do not yet have complete live UI proof.
// Keep these visible so the master gate cannot be mistaken for full coverage.
export const MISSING_LIVE_UI_JOURNEYS = Object.freeze([]);
