import type { GuidedFlowDefinition } from "../model";

export const INITIALIZE_KODY_ENGINE_FLOW_ID = "initialize-kody-engine";

export const INITIALIZE_KODY_ENGINE_FLOW: GuidedFlowDefinition =
  {
    id: INITIALIZE_KODY_ENGINE_FLOW_ID,
    version: 1,
    title: "Initialize Kody Engine",
    completionRouteId: "chat",
    controls: ["back"],
    steps: [
      {
        id: "prepare",
        title: "Prepare the repository",
        explanation:
          "## Before you start\n\nThis flow sets up Kody Engine in the **active repository**.\n\nIt installs or updates:\n\n- `.github/workflows/kody.yml`\n- `kody.config.json`\n- the repository webhook and runtime connection\n\n> Confirm that the active repository is correct, then select **Continue**.",
        rendererSlug: "approval-card",
        rendererData: {
          title: "Prepare the repository",
          actions: [
            {
              id: "continue",
              label: "Continue",
              response: "continue",
              variant: "primary",
            },
          ],
        },
        actions: [
          {
            id: "continue",
            target: { type: "step", stepId: "initialize" },
          },
        ],
      },
      {
        id: "initialize",
        type: "command",
        title: "Initialize Kody Engine",
        explanation:
          "## Install Kody Engine\n\nRun the standard `/init` command for the active repository.\n\n> Select **Run command**, wait for the completion summary, then select **Continue**.",
        command: "/init",
        actions: [
          { id: "run", target: { type: "stay" } },
          { id: "continue", target: { type: "step", stepId: "review" } },
        ],
      },
      {
        id: "review",
        title: "Review the engine setup",
        explanation:
          "## Review the installed files\n\nCheck that `/init` created or updated:\n\n- `.github/workflows/kody.yml`\n- `kody.config.json`\n\nRead the installer summary for any remaining next steps.\n\n> When the files look ready, return to Chat and select **Continue**.",
        routeId: "files",
        rendererSlug: "approval-card",
        rendererData: {
          title: "Review the installed files",
          actions: [
            {
              id: "continue",
              label: "Continue",
              response: "continue",
              variant: "primary",
            },
          ],
        },
        actions: [
          { id: "continue", target: { type: "step", stepId: "complete" } },
        ],
      },
      {
        id: "complete",
        title: "Kody Engine is ready",
        explanation:
          "## Setup complete\n\nKody Engine is now configured for this repository.\n\nFor a quick runtime check:\n\n1. In Chat, select **Kody Live**.\n2. Ask a small read-only question about the repository.\n3. Review the matching GitHub Actions run.\n\nSelect **Finish** when you are done.",
        rendererSlug: "approval-card",
        rendererData: {
          title: "Kody Engine is ready",
          actions: [
            {
              id: "finish",
              label: "Finish",
              response: "finish",
              variant: "primary",
            },
          ],
        },
        actions: [{ id: "finish", target: { type: "complete" } }],
      },
    ],
  };
