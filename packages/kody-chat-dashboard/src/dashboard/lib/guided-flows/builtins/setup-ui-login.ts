import type { GuidedFlowDefinition } from "../model";

export const SETUP_UI_LOGIN_FLOW_ID = "setup-ui-login";

export const SETUP_UI_LOGIN_FLOW: GuidedFlowDefinition = {
  id: SETUP_UI_LOGIN_FLOW_ID,
  version: 1,
  title: "Set up UI login",
  controls: ["back"],
  steps: [
    {
      id: "choose",
      title: "Give Kody access to signed-in pages",
      explanation:
        "UI Review needs a test account only when the pages it checks require login. The login is stored for the active repository and is never shown in Chat.\n\nSet it up now, or skip this guide if the app is public or has no user interface.",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Set up UI login",
        actions: [
          {
            id: "setup",
            label: "Set up login",
            response: "setup",
            variant: "primary",
          },
          {
            id: "skip",
            label: "Skip for now",
            response: "skip",
            variant: "secondary",
          },
        ],
      },
      actions: [
        {
          id: "setup",
          target: { type: "step", stepId: "save-username" },
        },
        { id: "skip", target: { type: "complete" } },
      ],
    },
    {
      id: "save-username",
      title: "Save the UI test username",
      explanation:
        "On the Variables page, add `LOGIN_USER` with the email address or username for the app's test account.\n\nReturn to Chat and select **Continue** after it is saved.",
      routeId: "variables",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Save the test username",
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
          target: { type: "step", stepId: "save-password" },
        },
      ],
    },
    {
      id: "save-password",
      title: "Save the UI test password",
      explanation:
        "On the Secrets page, add `LOGIN_PASSWORD` with the password for the same test account. Keep the password in Secrets; never paste it into Chat.\n\nReturn to Chat and select **Continue** after it is saved.",
      routeId: "secrets",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Save the test password",
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
          target: { type: "step", stepId: "ready" },
        },
      ],
    },
    {
      id: "ready",
      title: "UI login is ready to test",
      explanation:
        "The credentials are saved. The next UI Review of a signed-in page will test them. If they are missing or rejected, the review will stop and Kody will add an Inbox alert.\n\nSelect **Finish** to complete this guide.",
      rendererSlug: "approval-card",
      rendererData: {
        title: "UI login is configured",
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
