import { config as loadDotenv } from "dotenv";

loadDotenv({ path: new URL("../.env", import.meta.url), quiet: true });

const baseUrl = (process.env.QUALITY_BASE_URL ?? "http://127.0.0.1:3333").replace(/\/$/, "");
const owner = process.env.QUALITY_OWNER ?? "aharonyaircohen";
const repo = process.env.QUALITY_REPO ?? "kody-chat";
const token = process.env.E2E_GITHUB_TOKEN;

if (!token) throw new Error("E2E_GITHUB_TOKEN is required");

const headers = {
  "Content-Type": "application/json",
  "x-kody-token": token,
  "x-kody-owner": owner,
  "x-kody-repo": repo,
};

const action = (slug, name, outcome, area) => ({ slug, name, outcome, area });
const journey = (slug, name, goal, actions, expectedVisible, expectedState, options = {}) => ({
  slug,
  name,
  goal,
  actions,
  expectedVisible,
  expectedState,
  priority: options.priority ?? "high",
  given: options.given ?? "The dedicated QA account is signed in and the test repository is selected.",
  cleanup: options.cleanup ?? "Remove only records and files created by this run.",
});

const journeys = [
  journey(
    "authentication-and-repository-selection",
    "Connect and restore a repository",
    "Select the test repository and keep it selected after reload.",
    [
      action("open-repository-picker", "Open repository selection", "The repository selection screen shows repositories available to the signed-in user.", "authentication"),
      action("select-test-repository", "Select the test repository", "The dashboard opens on the selected repository and shows its owner and name.", "authentication"),
      action("reload-selected-repository", "Reload the selected repository", "The same repository remains selected after reload.", "persistence"),
    ],
    "The dashboard visibly shows the selected repository before and after reload.",
    "The authenticated repository selection remains saved after reload.",
  ),
  journey(
    "direct-kody-chat",
    "Complete a direct Kody chat turn",
    "Send an exact-marker prompt to a configured direct model and receive that marker.",
    [
      action("start-direct-conversation", "Start a direct conversation", "A new empty conversation is ready for input.", "chat"),
      action("select-configured-direct-model", "Select a configured direct model", "The selected enabled model is shown in Chat setup.", "chat"),
      action("send-direct-marker", "Send an exact-marker prompt", "The sent user message is visible in the conversation.", "chat"),
      action("receive-direct-marker", "Receive the exact marker", "A committed assistant reply containing the requested marker appears.", "chat"),
    ],
    "The exact requested marker is visible in the final assistant reply.",
    "The conversation stores the selected direct model and the committed assistant reply.",
    { priority: "critical" },
  ),
  journey(
    "engine-chat-visible-reply",
    "Complete an Engine chat turn",
    "Boot the live runner, send an exact marker, and receive the committed reply.",
    [
      action("select-live-engine", "Select Kody Live", "Chat setup shows Kody Live as the selected runtime.", "engine-chat"),
      action("boot-live-runner", "Boot the live runner", "The runner reaches the visible ready state and Chat input becomes enabled.", "engine-chat"),
      action("send-engine-marker", "Send an exact-marker prompt", "The prompt is accepted by the live runner.", "engine-chat"),
      action("receive-engine-marker", "Receive the Engine marker", "The committed assistant reply contains the requested marker.", "engine-chat"),
    ],
    "The runner is ready and the exact marker appears in the assistant reply.",
    "The Engine conversation contains the committed assistant reply for this run.",
    { priority: "critical" },
  ),
  journey(
    "brain-chat",
    "Complete a Brain chat turn",
    "Select Brain, send an exact marker, and receive a visible reply.",
    [
      action("select-brain-runtime", "Select Brain", "Chat visibly shows Brain as the selected runtime.", "brain"),
      action("send-brain-marker", "Send a Brain marker", "The marker prompt appears as the current user message.", "brain"),
      action("receive-brain-marker", "Receive the Brain marker", "Brain returns a visible reply containing the requested marker.", "brain"),
    ],
    "The Brain reply containing the requested marker is visible.",
    "The Brain turn is stored in the current conversation without a pending reply.",
  ),
  journey(
    "conversation-persistence",
    "Restore a saved conversation",
    "Send a direct-model marker and restore the same conversation after reload.",
    [
      action("send-persistence-marker", "Send a persistence marker", "The committed assistant reply contains the unique marker.", "chat"),
      action("reload-saved-conversation", "Reload the conversation", "The same user message and assistant marker reply return after reload.", "persistence"),
    ],
    "The same user message and assistant marker reply are visible after reload.",
    "The conversation, runtime selection, and committed messages remain saved.",
  ),
  journey(
    "attachments",
    "Send and restore an attachment",
    "Attach a test file, send it, and reopen it from the restored conversation.",
    [
      action("attach-chat-file", "Attach a test file", "The chosen file appears in the pending chat message before sending.", "attachments"),
      action("send-chat-attachment", "Send the attachment", "The sent message shows the attachment with its correct filename.", "attachments"),
      action("reopen-chat-attachment", "Reload and reopen the attachment", "The attachment remains available and opens after the conversation reloads.", "attachments"),
    ],
    "The sent attachment is visible and can be reopened after reload.",
    "The attachment reference and its parent message remain saved in the conversation.",
  ),
  journey(
    "rendered-views-and-approvals",
    "Complete a rendered approval",
    "Review a rendered Vibe approval, approve it once, and see execution continue.",
    [
      action("open-rendered-approval", "Open the rendered approval", "The approval view shows the requested change and available decision.", "renderers"),
      action("approve-rendered-change", "Approve the rendered change", "The approval is accepted once and cannot be submitted again.", "approvals"),
      action("observe-approved-execution", "Observe approved execution", "The run continues from approval to a visible result.", "approvals"),
    ],
    "The approval is visibly completed and the run reaches its result.",
    "Exactly one approval decision is stored for the request.",
  ),
  journey(
    "commands-and-context",
    "Use commands and repository context",
    "Choose a command or context source and complete a turn in the selected repository.",
    [
      action("open-command-context", "Open commands or context", "The available command or context choices load for the selected repository.", "context"),
      action("choose-command-context", "Choose a command or context source", "The chosen item is visibly attached to the pending turn.", "context"),
      action("send-context-turn", "Send the contextual turn", "The reply visibly uses the chosen command or repository context.", "context"),
    ],
    "The chosen command or context is visible on the turn and reflected in the reply.",
    "The conversation remains scoped to the selected repository.",
  ),
  journey(
    "agent-and-model-selection",
    "Use a selected agent and model",
    "Choose an agent and model, then complete a turn using both selections.",
    [
      action("choose-chat-agent", "Choose an agent", "Chat setup visibly shows the chosen agent.", "chat-setup"),
      action("choose-chat-model", "Choose a model", "Chat setup visibly shows the chosen model.", "chat-setup"),
      action("send-selected-runtime-turn", "Send a turn", "The turn completes without silently changing the selected agent or model.", "chat-setup"),
    ],
    "The chosen agent and model remain visible when the reply completes.",
    "The conversation stores the chosen runtime settings.",
  ),
  journey(
    "vibe-real-execution",
    "Complete a Vibe execution",
    "Request a unique welcome-text rename, approve it, and see the pushed repository change.",
    [
      action("request-vibe-rename", "Request the welcome-text rename", "Vibe shows the requested old and new text for approval.", "vibe"),
      action("approve-vibe-rename", "Approve the Vibe change", "The approval is accepted and the runner starts the approved work.", "vibe"),
      action("wait-for-vibe-result", "Wait for the Vibe result", "The run reaches a visible successful result without remaining pending.", "vibe"),
      action("verify-vibe-diff", "Verify the pushed diff", "The repository result shows the unique new text and no longer shows the old text.", "vibe"),
    ],
    "Vibe shows a successful result for the approved rename.",
    "The target repository contains the exact approved text change.",
    { priority: "critical", cleanup: "Restore the original welcome text after proof is captured." },
  ),
  journey(
    "brain-terminal-live-input",
    "Use Brain terminal input",
    "Select Brain, keep the terminal visible through the stall window, and enter input.",
    [
      action("open-brain-terminal", "Open the Brain terminal", "The xterm terminal is visible with Brain selected.", "terminal"),
      action("wait-through-terminal-stall", "Wait through the stall window", "The terminal remains mounted and does not disappear while idle.", "terminal"),
      action("enter-terminal-input", "Enter terminal input", "The terminal accepts and visibly echoes the new input.", "terminal"),
    ],
    "The Brain terminal remains visible and accepts the entered input.",
    "The active terminal session remains connected during the test.",
  ),
  journey(
    "ci-repair-chat-to-engine",
    "Run healthy CI repair through Chat",
    "Start CI Repair for a successful main-branch run without supplying a pull request.",
    [
      action("open-ci-repair-chat", "Open CI Repair", "The CI Repair page and repository-scoped Chat load.", "ci-repair"),
      action("request-main-ci-repair", "Request the main-branch CI run", "Chat accepts the real branch, run, and commit details without asking for a pull request.", "ci-repair"),
      action("complete-healthy-ci-workflow", "Complete CI Repair", "The workflow reaches done with check and finalize completed.", "ci-repair"),
    ],
    "CI Repair visibly reaches a completed result without requesting a pull request.",
    "A new CI Repair run is saved as done with check and finalize completed.",
  ),
  journey(
    "guided-flows-real-definitions",
    "Load Guided Flow definitions",
    "Open Guided Flows and load the real available definitions.",
    [
      action("open-guided-flows", "Open Guided Flows", "The Guided Flows page loads for the selected repository.", "guided-flows"),
      action("load-guided-flow-definitions", "Load flow definitions", "At least one real flow definition is shown without a loading or error state.", "guided-flows"),
    ],
    "The real Guided Flow definitions are visible.",
    "The displayed definitions come from the repository-scoped saved source.",
  ),
  journey(
    "guided-flows-real-persistence",
    "Create and restore a custom Guided Flow",
    "Create a custom flow, complete it, reload it, and remove it.",
    [
      action("create-custom-guided-flow", "Create a custom flow", "The new named flow appears in the Guided Flow list.", "guided-flows"),
      action("complete-custom-guided-flow", "Complete the custom flow", "The flow reaches its visible completed state.", "guided-flows"),
      action("reload-custom-guided-flow", "Reload the custom flow", "The completed flow and submitted answers return after reload.", "persistence"),
      action("delete-custom-guided-flow", "Delete the custom flow", "The test flow is removed and no longer appears.", "guided-flows"),
    ],
    "The custom flow can be created, completed, restored, and removed.",
    "Its definition, progress, and submitted answers persist until cleanup removes it.",
  ),
  journey(
    "guided-flows-real-chat-context",
    "Use Guided Flow context in Chat",
    "Submit a Guided Flow answer and have Chat read the current step and answer automatically.",
    [
      action("submit-guided-flow-answer", "Submit a flow answer", "The current Guided Flow step displays the submitted unique answer.", "guided-flows"),
      action("ask-chat-about-current-flow", "Ask Chat about the current flow", "Chat receives the current flow context without the user copying it manually.", "guided-flows"),
      action("receive-flow-context-reply", "Receive the context reply", "The reply includes the current step and unique submitted answer.", "guided-flows"),
    ],
    "Chat visibly returns the current Guided Flow step and submitted answer.",
    "The answer remains saved in the active flow state.",
  ),
  journey(
    "agent-guidance-real-persistence",
    "Persist agent guidance",
    "Create and remove real repository constraints and policies.",
    [
      action("create-agent-constraint", "Create a constraint", "The named constraint is saved and can be reopened.", "agent-guidance"),
      action("create-agent-policy", "Create a policy", "The named policy is saved and can be reopened.", "agent-guidance"),
      action("delete-agent-guidance", "Delete the test guidance", "Both test records are removed and no longer load.", "agent-guidance"),
    ],
    "The test constraint and policy are visible after creation and absent after cleanup.",
    "The records return from real persistence before deletion and return not found after deletion.",
  ),
  journey(
    "file-manager-real-mutations",
    "Mutate repository files safely",
    "Create a folder, upload and create files, move a file, then clean everything up.",
    [
      action("create-test-folder", "Create a test folder", "The File Manager opens the newly created uniquely named folder.", "files"),
      action("upload-test-file", "Upload a test file", "The uploaded file appears inside the folder with the expected name.", "files"),
      action("create-test-file", "Create a test file", "The new file exists inside the test folder.", "files"),
      action("move-test-file", "Move the test file", "The file appears at the new path and is absent from the old path.", "files"),
      action("delete-test-files", "Delete the test files", "All files and folders created by the run are removed.", "files"),
    ],
    "The File Manager visibly reflects each create, upload, move, and delete operation.",
    "GitHub contains each expected path after its operation and none of the test paths after cleanup.",
  ),
  journey(
    "view-renderers-real-data",
    "Show real view renderers",
    "Open renderer management and display the built-in renderer definitions.",
    [
      action("open-renderer-management", "Open renderer management", "The real renderer management page loads without an error state.", "renderers"),
      action("show-built-in-renderers", "Show built-in renderers", "The expected built-in renderer names and types are visible.", "renderers"),
    ],
    "The built-in renderer definitions are visible on the management page.",
    "The page uses the real active renderer catalog rather than sample data.",
  ),
  journey(
    "client-branded-chat",
    "Complete branded client chat",
    "Send an exact marker through branded client chat and restore its reply.",
    [
      action("open-branded-client-chat", "Open branded client chat", "The client chat opens with the saved brand appearance.", "client-chat"),
      action("send-client-chat-marker", "Send a client marker", "The branded chat returns the requested marker in its reply.", "client-chat"),
      action("reload-client-chat-marker", "Reload client chat", "The same marker reply returns after reload.", "client-chat"),
    ],
    "The branded chat visibly shows the marker reply before and after reload.",
    "The client conversation and brand appearance remain saved.",
  ),
  journey(
    "navigation-and-plugin-panels",
    "Navigate repository plugin panels",
    "Open the repository administration panels and keep repository context while moving between them.",
    [
      action("open-repository-panels", "Open repository panels", "Each required administration panel loads its real page content.", "navigation"),
      action("move-between-repository-panels", "Move between panels", "Navigation changes panels without leaving the selected repository.", "navigation"),
      action("retain-panel-repository-context", "Retain repository context", "The owner and repository remain unchanged across all visited panels.", "navigation"),
    ],
    "Every required panel loads and remains scoped to the same repository.",
    "Navigation does not change the authenticated repository selection.",
  ),
  journey(
    "mobile",
    "Complete mobile client chat",
    "Use client chat at the supported mobile size, send a marker, and restore it.",
    [
      action("open-mobile-client-chat", "Open mobile client chat", "The chat input and conversation are usable without desktop-only controls blocking them.", "mobile"),
      action("send-mobile-chat-marker", "Send a mobile marker", "The requested marker reply is readable in the mobile layout.", "mobile"),
      action("reload-mobile-chat-marker", "Reload mobile chat", "The same marker reply remains readable after reload.", "mobile"),
    ],
    "The mobile layout allows sending and reading the marker reply before and after reload.",
    "The mobile conversation remains saved after reload.",
  ),
  journey(
    "memory-real-lifecycle",
    "Manage typed memory through its lifecycle",
    "Create, revise, reload, and delete one uniquely named typed memory.",
    [
      action("create-typed-memory", "Create a typed memory", "The new memory opens with the exact title, summary, details, and creation reason.", "memory"),
      action("revise-typed-memory", "Revise the memory", "The changed summary and revision reason are visible.", "memory"),
      action("reload-typed-memory", "Reload the memory", "The revised memory and revision history remain visible after reload.", "persistence"),
      action("delete-typed-memory", "Delete the memory", "The deleted memory closes and no longer appears in Memory.", "memory"),
    ],
    "The created and revised values are visible, and the record disappears after deletion.",
    "The revision survives reload and the record is absent after cleanup.",
  ),
  journey(
    "memory-real-model-journeys",
    "Use real-model memory journeys",
    "Use a real model to create, retrieve, correct, list, and forget memory across supported kinds and scopes.",
    [
      action("create-model-memories", "Create model memories", "The model creates the requested memories across every supported kind and scope.", "memory"),
      action("retrieve-model-memories", "Retrieve scoped memories", "The model returns only the memories relevant to the requested repository and scope.", "memory"),
      action("correct-model-memory", "Correct a memory", "The corrected value is returned and its earlier value remains in revision history.", "memory"),
      action("forget-model-memory", "Forget a memory", "The forgotten memory is no longer returned or listed.", "memory"),
    ],
    "The model visibly confirms creation, scoped retrieval, correction, and forgetting with unique markers.",
    "Memory records and revision history match each operation, and forgotten records are absent.",
  ),
];

if (journeys.length !== 23 || new Set(journeys.map(({ slug }) => slug)).size !== 23) {
  throw new Error("The Quality live suite must contain exactly 23 unique Journeys");
}

const actions = [...new Map(journeys.flatMap((item) => item.actions).map((item) => [item.slug, item])).values()];
const referencedActionSlugs = new Set(journeys.flatMap((item) => item.actions.map(({ slug }) => slug)));
if (actions.length !== referencedActionSlugs.size) throw new Error("Action slugs must be unique and consistent");

const api = async (resource, body) => {
  const response = await fetch(`${baseUrl}/api/kody/quality/${resource}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${resource}/${body.slug}: HTTP ${response.status} ${JSON.stringify(payload)}`);
  return payload;
};

for (const item of actions) await api("actions", { ...item, status: "draft" });

for (const item of journeys) {
  await api("journeys", {
    slug: item.slug,
    name: item.name,
    goal: item.goal,
    priority: item.priority,
    status: "draft",
    actionSlugs: item.actions.map(({ slug }) => slug),
  });
  await api("scenarios", {
    slug: `live-${item.slug}`,
    journeySlugs: [item.slug],
    name: `Live: ${item.name}`,
    kind: item.slug.includes("persistence") || item.slug.includes("memory") ? "persistence" : "happy",
    given: item.given,
    expectedVisible: item.expectedVisible,
    expectedState: item.expectedState,
    cleanup: item.cleanup,
    status: "draft",
  });
}

console.log(JSON.stringify({
  target: `${owner}/${repo}`,
  savedActions: actions.length,
  savedJourneys: journeys.length,
  savedScenarios: journeys.length,
  status: "draft",
}));
