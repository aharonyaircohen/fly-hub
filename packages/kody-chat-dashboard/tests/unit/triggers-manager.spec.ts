import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/TriggersManager.tsx"),
  "utf8",
);

describe("TriggersManager data fetching", () => {
  it("queries triggers and user-state namespaces from the kody API", () => {
    expect(SOURCE).toContain('"/api/kody/triggers"');
    expect(SOURCE).toContain('"/api/kody/user-state"');
  });

  it("scopes query keys per repo so switching repos refetches", () => {
    expect(SOURCE).toContain('["kody-triggers", owner, repo] as const');
    expect(SOURCE).toContain(
      '["kody-user-state-namespaces", owner, repo] as const',
    );
  });

  it("only fetches once authenticated and sends auth headers", () => {
    expect(SOURCE).toContain("enabled: !!auth");
    expect(SOURCE).toContain("buildAuthHeaders(auth)");
  });

  it("surfaces API error details instead of a bare status code when available", () => {
    expect(SOURCE).toContain(
      "json.detail || json.message || json.error || `HTTP ${res.status}`",
    );
  });

  it("bypasses the browser cache on every fetch", () => {
    expect(SOURCE).toContain('cache: "no-store"');
  });

  it("loads GitHub and Kody workflow choices only for the relevant trigger form", () => {
    expect(SOURCE).toContain('"/api/kody/github/workflows"');
    expect(SOURCE).toContain('"/api/kody/company/workflows"');
    expect(SOURCE).toContain("enabled: !!auth && !!editor");
    expect(SOURCE).toContain("staleTime: 5 * 60 * 1000");
  });
});

describe("TriggersManager listing", () => {
  it("shows a spinner while loading and an empty state with a hint otherwise", () => {
    expect(SOURCE).toContain("triggersQuery.isLoading");
    expect(SOURCE).toContain('title="No triggers yet"');
  });

  it("summarizes each trigger in readable When → Then language", () => {
    expect(SOURCE).toContain("When {EVENT_LABELS[trigger.event]");
    expect(SOURCE).toContain('"start a Kody workflow"');
    expect(SOURCE).toContain('"save event data"');
  });

  it("toggles enabled state by re-posting the trigger with enabled flipped", () => {
    expect(SOURCE).toContain(
      "trigger: { ...trigger, enabled: !trigger.enabled }",
    );
  });
});

describe("TriggersManager editor", () => {
  it("opens a blank editor with generic trigger and action choices", () => {
    expect(SOURCE).toContain('event: ""');
    expect(SOURCE).toContain('actionType: ""');
    expect(SOURCE).toContain(
      'setEditor(emptyEditor(namespaces[0]?.name ?? ""))',
    );
    expect(SOURCE).toContain("conditions: []");
    expect(SOURCE).toContain("map: []");
  });

  it("prefills the editor from an existing trigger with pretty-printed JSON", () => {
    expect(SOURCE).toContain("conditionRows(");
    expect(SOURCE).toContain("trigger.conditions.filter");
    expect(SOURCE).toContain("action.inputMap");
    expect(SOURCE).toContain("action.map");
  });

  it("slugifies the name into an id only for new triggers", () => {
    expect(SOURCE).toContain(
      "state.isNew ? slugifyTitle(state.name) : state.id",
    );
  });

  it("disables Save while pending or when name/namespace are missing", () => {
    expect(SOURCE).toContain("saveMutation.isPending ||");
    expect(SOURCE).toContain("!editor.name.trim() ||");
    expect(SOURCE).toContain("!editor.namespace");
  });

  it("updates editor state immutably via spread", () => {
    expect(SOURCE).toContain("setEditor({ ...editor, name: e.target.value })");
    expect(SOURCE).toMatch(/setEditor\(\{\s+\.\.\.editor,\s+event: value,/);
  });

  it("uses a simple When trigger, Then action flow", () => {
    expect(SOURCE).toContain("<Label>When</Label>");
    expect(SOURCE).toContain('aria-label="Trigger"');
    expect(SOURCE).toContain("<Label>Then</Label>");
    expect(SOURCE).toContain('aria-label="Action"');
    expect(SOURCE).not.toContain("When GitHub workflow");
    expect(SOURCE).not.toContain("Use a different trigger");
    expect(SOURCE).toContain('aria-label="GitHub workflow"');
    expect(SOURCE).toContain("<Label>Result</Label>");
    expect(SOURCE).toContain("Start a Kody workflow");
    expect(SOURCE).toContain('aria-label="Kody workflow to start"');
    expect(SOURCE).toContain("githubWorkflowId");
    expect(SOURCE).toContain("workflowDefinitionsQuery.data");
    expect(SOURCE).not.toContain('htmlFor="trigger-workflow"');
  });

  it("only offers actions supported by the selected trigger", () => {
    expect(SOURCE).toContain("function actionTypeForEvent(event: string)");
    expect(SOURCE).toContain("actionType: actionTypeForEvent(value),");
    expect(SOURCE).toContain(
      "editor.event === GITHUB_WORKFLOW_COMPLETED_EVENT ? (",
    );
    expect(SOURCE).toContain('state.actionType === "start-pipeline"');
    expect(SOURCE).toContain('value="start-pipeline"');
    expect(SOURCE).toContain('"kody.workflow.completed"');
    expect(SOURCE).toContain('aria-label="Kody workflow that finished"');
  });

  it("only offers workflows that policy allows to run automatically", () => {
    expect(SOURCE).toContain("workflow.automation.eligible");
    expect(SOURCE).toContain("No workflows can run automatically");
  });

  it("does not expose payload filters or input mapping in the editor", () => {
    expect(SOURCE).not.toContain("More filters and input mapping");
    expect(SOURCE).not.toContain("Additional filters");
    expect(SOURCE).not.toContain("Pass these values");
    expect(SOURCE).not.toContain('aria-label="Condition payload path"');
    expect(SOURCE).not.toContain('aria-label="Workflow input source"');
  });

  it("can limit GitHub workflow triggers to pull request runs", () => {
    expect(SOURCE).toContain("Pull request runs only");
    expect(SOURCE).toContain('path: "pr", op: "exists"');
    expect(SOURCE).toContain("withPullRequestOnlyCondition(");
  });

  it("offers an explicit all GitHub workflows choice", () => {
    expect(SOURCE).toContain('value="all-github-workflows"');
    expect(SOURCE).toContain("All GitHub workflows");
    expect(SOURCE).toContain("githubWorkflowId: null");
    expect(SOURCE).toContain('githubWorkflowName: ""');
  });

  it("maps only declared workflow inputs from the event payload", () => {
    expect(SOURCE).toContain("defaultInputMap(");
    expect(SOURCE).toContain("target?.inputSchema?.properties");
    expect(SOURCE).toContain("`payload.${key}`");
  });
});

describe("TriggersManager validation and errors", () => {
  it("preserves stored condition and mapping rows when saving", () => {
    expect(SOURCE).toContain("state.conditions");
    expect(SOURCE).toContain("state.map");
  });

  it("toasts errors from every mutation", () => {
    const errorToasts = SOURCE.match(
      /onError: \(error: Error\) => toast\.error\(error\.message\)/g,
    );
    expect(errorToasts).toHaveLength(3);
  });

  it("closes the editor and refetches only on successful save", () => {
    expect(SOURCE).toContain('toast.success("Trigger saved")');
    expect(SOURCE).toContain("setEditor(null)");
    expect(SOURCE).toContain("void invalidate()");
  });
});

describe("TriggersManager deletion", () => {
  it("requires confirmation via ConfirmDialog before deleting", () => {
    expect(SOURCE).toContain("<ConfirmDialog");
    expect(SOURCE).toContain('confirmLabel="Delete"');
    expect(SOURCE).toContain(
      "deleteTarget && deleteMutation.mutate(deleteTarget.id)",
    );
  });

  it("deletes via DELETE with an encoded id and accepts 204 responses", () => {
    expect(SOURCE).toContain("`/api/kody/triggers/${encodeURIComponent(id)}`");
    expect(SOURCE).toContain('method: "DELETE"');
    expect(SOURCE).toContain("!res.ok && res.status !== 204");
  });
});
