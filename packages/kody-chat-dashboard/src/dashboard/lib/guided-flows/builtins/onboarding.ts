import type { GuidedFlowDefinition } from "../model";

export const ONBOARDING_FLOW_ID = "onboarding";

export const ONBOARDING_FLOW_V1: GuidedFlowDefinition = {
  id: ONBOARDING_FLOW_ID,
  version: 1,
  title: "Get started with Kody",
  completionRouteId: "chat",
  controls: ["back"],
  steps: [
    {
      id: "welcome",
      title: "Welcome to Kody",
      explanation:
        "Let's finish the three things Kody needs before your first chat.\n\n**You'll complete three quick steps:**\n\n1. Create a GitHub personal access token.\n2. Connect your first repository.\n3. Add `OPENROUTER_API_KEY`.\n\n> Complete each task, then return to Chat and select **Next**.",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Welcome to Kody",
        actions: [
          {
            id: "next",
            label: "Get started",
            response: "next",
            variant: "primary",
          },
        ],
      },
      actions: [
        {
          id: "next",
          target: {
            type: "step",
            stepId: "create-github-pat",
          },
        },
      ],
    },
    {
      id: "create-github-pat",
      title: "Create a GitHub personal access token",
      explanation:
        "Kody needs a GitHub personal access token before it can connect to your repository.\n\n**On GitHub:**\n\n1. [Create a personal access token](https://github.com/settings/tokens/new?description=Kody+Dashboard&scopes=repo,workflow,admin:repo_hook).\n2. Grant the `repo`, `workflow`, and `admin:repo_hook` scopes.\n3. Copy the token—you will paste it in the next step.\n\n> Keep the token private.\n\nReturn to Chat and select **Next**.",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Create your GitHub PAT",
        actions: [
          {
            id: "next",
            label: "Next",
            response: "next",
            variant: "primary",
          },
        ],
      },
      actions: [
        {
          id: "next",
          target: { type: "step", stepId: "connect-repository" },
        },
      ],
    },
    {
      id: "connect-repository",
      title: "Connect your first repository",
      explanation:
        "Use the GitHub PAT you just created to connect your first repository.\n\n**On the Org page:**\n\n1. Enter the repository URL or `owner/repo`.\n2. Paste your personal access token.\n3. Select **Connect repository**.\n\nReturn to Chat and select **Next**.",
      routeId: "org",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Connect your first repository",
        actions: [
          {
            id: "next",
            label: "Next",
            response: "next",
            variant: "primary",
          },
        ],
      },
      actions: [
        {
          id: "next",
          target: { type: "step", stepId: "add-openrouter-key" },
        },
      ],
    },
    {
      id: "add-openrouter-key",
      title: "Add your OpenRouter key",
      explanation:
        "The built-in OpenRouter Free model becomes available after its API key is saved.\n\n**On the Secrets page:**\n\n1. Add a secret named `OPENROUTER_API_KEY`.\n2. Paste your OpenRouter API key as the value.\n3. Save the secret.\n\nReturn to Chat and select **Next**.",
      routeId: "secrets",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Activate built-in Chat",
        actions: [
          {
            id: "next",
            label: "Next",
            response: "next",
            variant: "primary",
          },
        ],
      },
      actions: [{ id: "next", target: { type: "step", stepId: "ready" } }],
    },
    {
      id: "ready",
      title: "Setup steps complete",
      explanation:
        "Kody now has repository access and a Chat model.\n\n**You're ready.**\n\nSelect **Finish** to open Chat, then send your first message.",
      rendererSlug: "approval-card",
      rendererData: {
        title: "You are ready to try Chat",
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

export const ONBOARDING_FLOW_V2: GuidedFlowDefinition = {
  id: ONBOARDING_FLOW_ID,
  version: 2,
  title: "Get started with Kody",
  completionRouteId: "chat",
  controls: ["back"],
  steps: [
    {
      id: "welcome",
      title: "Your private Chat is ready",
      explanation:
        "Your Chat belongs to you and works without a repository. Its history stays with you when you attach or switch repositories.\n\nChoose **Start chatting** now, or attach a repository to add repository pages, tools, and Agency.",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Your private Chat is ready",
        actions: [
          {
            id: "finish",
            label: "Start chatting",
            response: "finish",
            variant: "primary",
          },
          {
            id: "repository",
            label: "Attach a repository",
            response: "repository",
            variant: "secondary",
          },
        ],
      },
      actions: [
        { id: "finish", target: { type: "complete" } },
        {
          id: "repository",
          target: { type: "step", stepId: "attach-repository" },
        },
      ],
    },
    {
      id: "attach-repository",
      title: "Add repository tools",
      explanation:
        "Attach a repository from the repository switcher. This adds repository context, pages, tools, and Agency to the same Chat; it does not create a separate Chat or replace your history.\n\nWhen the repository is connected, return to Chat and select **Finish**.",
      routeId: "org",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Attach a repository when you need one",
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

export const ONBOARDING_FLOW_V4: GuidedFlowDefinition = {
  id: ONBOARDING_FLOW_ID,
  version: 4,
  title: "Get started with Kody",
  completionRouteId: "chat",
  controls: ["back"],
  steps: [
    {
      id: "choose-chat-provider",
      title: "Set up Chat (optional)",
      explanation:
        "Set up a free provider for Kody Chat, or skip this step and configure a model later from **Models**.\n\nBoth providers use one API key and work with Kody's OpenAI-compatible Chat setup.",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Set up Chat",
        actions: [
          {
            id: "openrouter",
            label: "Set up OpenRouter",
            response: "openrouter",
            variant: "primary",
          },
          {
            id: "xkiro",
            label: "Set up xKiro",
            response: "xkiro",
            variant: "secondary",
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
          id: "openrouter",
          target: { type: "step", stepId: "add-openrouter-key" },
        },
        {
          id: "xkiro",
          target: { type: "step", stepId: "add-xkiro-key" },
        },
        { id: "skip", target: { type: "step", stepId: "welcome" } },
      ],
    },
    {
      id: "add-openrouter-key",
      title: "Add your OpenRouter key",
      explanation:
        "The built-in OpenRouter Free model becomes available after its API key is saved.\n\n**On the Secrets page:**\n\n1. Add a secret named `OPENROUTER_API_KEY`.\n2. Paste your OpenRouter API key as the value.\n3. Save the secret.\n\nYou can continue without adding it and configure Chat later.",
      routeId: "secrets",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Activate OpenRouter Free",
        actions: [
          { id: "next", label: "Continue", response: "next", variant: "primary" },
        ],
      },
      actions: [
        { id: "next", target: { type: "step", stepId: "welcome" } },
      ],
    },
    {
      id: "add-xkiro-key",
      title: "Add your xKiro key",
      explanation:
        "The built-in xKiro Free model becomes available after its API key is saved. xKiro currently offers free access without a credit card.\n\n**On the Secrets page:**\n\n1. Create a free account at [xkiro.com](https://xkiro.com/).\n2. Create and copy an API key.\n3. Add a secret named `XKIRO_API_KEY`.\n4. Paste the key as the value and save it.\n\nYou can continue without adding it and configure Chat later.",
      routeId: "secrets",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Activate xKiro Free",
        actions: [
          { id: "next", label: "Continue", response: "next", variant: "primary" },
        ],
      },
      actions: [
        { id: "next", target: { type: "step", stepId: "welcome" } },
      ],
    },
    {
      id: "attach-repository",
      title: "Add repository tools",
      explanation:
        "Attach a repository from the repository switcher. This adds repository context, pages, tools, and Agency to the same Chat; it does not create a separate Chat or replace your history.\n\n**Before connecting, make sure your GitHub token can manage repository webhooks:**\n\n- Fine-grained token: grant **Webhooks: Read and write**.\n- Classic token: grant `admin:repo_hook`.\n\nWhen the repository is connected, return to Chat and select **Continue**.",
      routeId: "org",
      rendererSlug: "approval-card",
      rendererData: {
        title: "Attach a repository when you need one",
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
          target: { type: "step", stepId: "initialize-repository" },
        },
      ],
    },
    {
      id: "initialize-repository",
      type: "command",
      title: "Verify the repository connection",
      explanation:
        "Run `/init` for the active repository. It installs or updates Kody Engine and verifies the repository webhook.\n\n> Select **Run command** and wait for the summary. If webhook setup failed, update the token permission and run `/init` again before continuing.",
      command: "/init",
      actions: [
        { id: "run", target: { type: "stay" } },
        { id: "finish", target: { type: "step", stepId: "welcome" } },
      ],
    },
    ONBOARDING_FLOW_V2.steps[0]!,
  ],
};

const verifyProviderStep = (
  id: string,
  title: string,
  command: string,
): GuidedFlowDefinition["steps"][number] => ({
  id,
  type: "command",
  title,
  explanation:
    "Run one small readiness check. Kody will verify that this model can produce the tool responses required by Chat and Guided Flows. No repository action will run.",
  command,
  actions: [
    { id: "run", target: { type: "stay" } },
    { id: "continue", target: { type: "step", stepId: "welcome" } },
  ],
});

export const ONBOARDING_FLOW: GuidedFlowDefinition = {
  ...ONBOARDING_FLOW_V4,
  version: 5,
  steps: ONBOARDING_FLOW_V4.steps.flatMap((step) => {
    if (step.id === "add-openrouter-key") {
      return [
        {
          ...step,
          actions: [
            {
              id: "next",
              target: { type: "step" as const, stepId: "verify-openrouter" },
            },
          ],
        },
        verifyProviderStep(
          "verify-openrouter",
          "Verify OpenRouter Chat",
          "/check-chat openrouter/free",
        ),
      ];
    }
    if (step.id === "add-xkiro-key") {
      return [
        {
          ...step,
          actions: [
            {
              id: "next",
              target: { type: "step" as const, stepId: "verify-xkiro" },
            },
          ],
        },
        verifyProviderStep(
          "verify-xkiro",
          "Verify xKiro Chat",
          "/check-chat xkiro/deepseek/deepseek-v4-flash",
        ),
      ];
    }
    return [step];
  }),
};
