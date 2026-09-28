/**
 * @testFramework vitest
 * @domain kody-chat
 */
import { describe, expect, it } from "vitest";
import { asSchema } from "ai";
import { createUiTools } from "../../../app/api/kody/chat/tools/ui-tools";
import { FINAL_ANSWER_TOOL } from "../../../src/dashboard/lib/chat-output-tools";
import { FOLLOW_UP_QUESTION_CONTRACT } from "../../../src/dashboard/lib/chat-defaults/defaults";
import { DASHBOARD_NAVIGATE_DIRECTIVE } from "../../../src/dashboard/lib/chat-ui-actions";
import type { ViewRendererDefinition } from "../../../src/dashboard/lib/view-renderers/standalone-renderer-store";

describe("ui tools", () => {
  const decisionRenderer: ViewRendererDefinition = {
    slug: "decision-card",
    name: "Decision card",
    purpose: "decision",
    rule: "Use this purpose when Kody presents a decision.",
    data: {
      title: { type: "text", description: "Short heading." },
      body: { type: "text", description: "Supporting text." },
      actions: {
        type: "actions",
        description: "Available responses.",
      },
    },
    defaults: {
      actions: [
        {
          id: "continue",
          label: "Continue",
          response: "continue",
          variant: "primary",
        },
      ],
    },
    type: "layout",
    ui: {
      type: "stack",
      children: [
        { type: "text", value: "$title", variant: "title" },
        { type: "text", value: "$body" },
        {
          type: "row",
          for: "$actions",
          as: "action",
          item: { type: "button", label: "$action.label", action: "$action" },
        },
      ],
    },
  };

  it("describes the spec catalog in the show_view tool description", () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const showView = tools.show_view as { description?: string };

    expect(showView).toBeTruthy();
    expect(String(showView.description)).toContain("Spec format");
    expect(String(showView.description)).toContain("DecisionCard");
    expect(String(showView.description)).toContain(
      "Use this purpose when Kody presents a decision.",
    );
    expect(String(showView.description)).toContain(
      "Section counts must match the number of visible items; omit a count when it is uncertain.",
    );
  });

  it("exposes a generic final output tool", () => {
    const tools = createUiTools() as Record<string, unknown>;
    expect(tools[FINAL_ANSWER_TOOL]).toBeTruthy();
  });

  it("rejects final text that still asks the user for interaction", async () => {
    const tools = createUiTools() as Record<string, unknown>;
    const finalAnswer = tools[FINAL_ANSWER_TOOL] as {
      execute: (value: { content: string }) => Promise<Record<string, unknown>>;
    };

    await expect(
      finalAnswer.execute({
        content: "I can create the Todo list if you provide the name you want.",
      }),
    ).resolves.toEqual({
      error: expect.stringContaining("show_view"),
    });
    await expect(
      finalAnswer.execute({
        content: "Agency connects Agents, Capabilities, and Workflows.",
      }),
    ).resolves.toEqual({
      error: expect.stringContaining("follow-up question"),
    });
    await expect(
      finalAnswer.execute({
        content:
          "Agency connects Agents, Capabilities, and Workflows. What should I inspect next?",
      }),
    ).resolves.toEqual({
      content:
        "Agency connects Agents, Capabilities, and Workflows. What should I inspect next?",
    });
    await expect(
      finalAnswer.execute({
        content:
          "Kody Chat uses the project's existing chat owner. Would you like me to explain one part in more detail?",
      }),
    ).resolves.toEqual({
      content:
        "Kody Chat uses the project's existing chat owner. Would you like me to explain one part in more detail?",
    });
  });

  it("accepts exact output without adding a follow-up question", async () => {
    const tools = createUiTools({ requireFollowUpQuestion: false }) as Record<
      string,
      unknown
    >;
    const finalAnswer = tools[FINAL_ANSWER_TOOL] as {
      execute: (value: { content: string }) => Promise<Record<string, unknown>>;
    };

    await expect(
      finalAnswer.execute({ content: "ORBIT-7392" }),
    ).resolves.toEqual({ content: "ORBIT-7392" });
  });

  it("normalizes exact output at the final-answer owner", async () => {
    const tools = createUiTools({
      requireFollowUpQuestion: false,
      userText: "Reply only: remembered.",
    }) as Record<string, unknown>;
    const finalAnswer = tools[FINAL_ANSWER_TOOL] as {
      execute: (value: { content: string }) => Promise<Record<string, unknown>>;
    };
    await expect(
      finalAnswer.execute({ content: "remembered." }),
    ).resolves.toEqual({
      content: "remembered",
    });
  });

  it("navigates only to known dashboard routes", async () => {
    const tools = createUiTools() as Record<string, unknown>;
    const dashboardNavigate = tools.dashboard_navigate as {
      execute: (value: {
        routeId: string;
        reason: string;
        issueNumber?: number;
      }) => Promise<Record<string, unknown>>;
    };

    await expect(
      dashboardNavigate.execute({
        routeId: "secrets",
        reason: "Opening the secrets vault.",
      }),
    ).resolves.toEqual({
      action: DASHBOARD_NAVIGATE_DIRECTIVE,
      routeId: "secrets",
      href: "/secrets",
      label: "Secrets",
      reason: "Opening the secrets vault.",
    });

    await expect(
      dashboardNavigate.execute({
        routeId: "not-real",
        reason: "Opening nowhere.",
      }),
    ).resolves.toMatchObject({
      error: expect.stringContaining("Unknown dashboard route"),
    });
  });

  it("supports task detail navigation by issue number", async () => {
    const tools = createUiTools() as Record<string, unknown>;
    const dashboardNavigate = tools.dashboard_navigate as {
      execute: (value: {
        routeId: string;
        reason: string;
        issueNumber?: number;
      }) => Promise<Record<string, unknown>>;
    };

    await expect(
      dashboardNavigate.execute({
        routeId: "task",
        issueNumber: 42,
        reason: "Opening task 42.",
      }),
    ).resolves.toMatchObject({
      action: DASHBOARD_NAVIGATE_DIRECTIVE,
      routeId: "task",
      href: "/42",
      label: "Task #42",
    });
  });

  it("rejects proactive dashboard navigation when the user asked only for guidance", async () => {
    const tools = createUiTools({
      userText: "i want to post text to fb, guide me how",
    }) as Record<string, unknown>;
    const dashboardNavigate = tools.dashboard_navigate as {
      execute: (value: {
        routeId: string;
        reason: string;
      }) => Promise<Record<string, unknown>>;
    };

    await expect(
      dashboardNavigate.execute({
        routeId: "connections",
        reason: "Opening Connections to configure Facebook.",
      }),
    ).resolves.toEqual({ error: "dashboard_navigation_not_requested" });
  });

  it("allows dashboard navigation when the user explicitly requests it", async () => {
    const tools = createUiTools({
      userText: "Open the Views page so I can use the browser.",
    }) as Record<string, unknown>;
    const dashboardNavigate = tools.dashboard_navigate as {
      execute: (value: {
        routeId: string;
        reason: string;
      }) => Promise<Record<string, unknown>>;
    };

    await expect(
      dashboardNavigate.execute({
        routeId: "preview",
        reason: "Opening Views.",
      }),
    ).resolves.toMatchObject({
      action: DASHBOARD_NAVIGATE_DIRECTIVE,
      routeId: "preview",
      href: "/preview",
    });
  });

  it("rejects a browser URL that Kody inferred instead of reading from the user", async () => {
    const tools = createUiTools({
      userText: "Open task 4017 in the page.",
    }) as Record<string, unknown>;
    const previewAct = tools.preview_act as {
      execute: (value: {
        op: "navigate";
        url: string;
        reason: string;
      }) => Promise<Record<string, unknown>>;
    };

    await expect(
      previewAct.execute({
        op: "navigate",
        url: "/repo/acme/widgets/tasks/4017",
        reason: "Opening task 4017.",
      }),
    ).resolves.toEqual({
      error: "browser_navigation_url_not_requested",
    });
  });

  it("allows browser navigation to an exact URL supplied by the user", async () => {
    const tools = createUiTools({
      userText: "Open https://example.com/docs in the page.",
    }) as Record<string, unknown>;
    const previewAct = tools.preview_act as {
      execute: (value: {
        op: "navigate";
        url: string;
        reason: string;
      }) => Promise<Record<string, unknown>>;
    };

    await expect(
      previewAct.execute({
        op: "navigate",
        url: "https://example.com/docs",
        reason: "Opening the requested URL.",
      }),
    ).resolves.toMatchObject({
      action: "preview_act",
      op: "navigate",
      url: "https://example.com/docs",
    });
  });

  it("does not reclassify committed final text into a rendered view", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const finalAnswer = tools[FINAL_ANSWER_TOOL] as {
      execute: (value: { content: string }) => Promise<{ error?: string }>;
    };

    await expect(
      finalAnswer.execute({
        content:
          "Want me to file this as a bug issue in the repo so a dev can pick it up, or should I draft the small code change here?",
      }),
    ).resolves.toEqual({
      content:
        "Want me to file this as a bug issue in the repo so a dev can pick it up, or should I draft the small code change here?",
    });
  });

  it("requires plain final answers to end with a follow-up question", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const finalAnswer = tools[FINAL_ANSWER_TOOL] as {
      execute: (value: { content: string }) => Promise<{ content?: string }>;
    };

    await expect(
      finalAnswer.execute({
        content: "The bug is in the login redirect handler.",
      }),
    ).resolves.toEqual({
      error: expect.stringContaining("follow-up question"),
    });
  });

  it("gives final-answer retries the self-contained follow-up contract", () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const finalAnswer = tools[FINAL_ANSWER_TOOL] as {
      description?: string;
    };

    expect(finalAnswer.description).toContain(FOLLOW_UP_QUESTION_CONTRACT);
  });

  it("returns a model-readable error for the legacy purpose/data shape", async () => {
    const tools = createUiTools() as Record<string, unknown>;
    const showView = tools.show_view as {
      execute: (value: Record<string, unknown>) => Promise<{ error?: string }>;
    };

    await expect(
      showView.execute({
        purpose: "approval-card",
        data: {},
        title: "Confirm?",
      }),
    ).resolves.toMatchObject({
      error: expect.stringContaining("root"),
    });
  });

  it("renders a valid spec into a render_view directive", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const showView = tools.show_view as {
      execute: (value: Record<string, unknown>) => Promise<{
        error?: string;
        action?: string;
        rendererSlug?: string;
      }>;
    };

    await expect(
      showView.execute({
        root: "a",
        elements: {
          a: {
            type: "DecisionCard",
            props: { title: "Continue?", body: "Pick one." },
          },
        },
      }),
    ).resolves.toMatchObject({
      action: "render_view",
      rendererSlug: "decision-card",
    });
  });

  it("rejects an unbound approval card for a repository mutation", async () => {
    const tools = createUiTools({
      userText: "Prepare that exact chore task now.",
    }) as Record<string, unknown>;
    const showView = tools.show_view as {
      execute: (value: Record<string, unknown>) => Promise<{ error?: string }>;
    };

    await expect(
      showView.execute({
        root: "card",
        elements: {
          card: {
            type: "ApprovalCard",
            props: { title: "Create the chore?", body: "Ready to create." },
          },
        },
      }),
    ).resolves.toEqual({
      error: expect.stringContaining("matching action tool"),
    });
  });

  it("rejects an unbound approval card for repository self-configuration", async () => {
    const tools = createUiTools({
      userText:
        "Configure this repository with a capability, workflow, and loop.",
    }) as Record<string, unknown>;
    const showView = tools.show_view as {
      execute: (value: Record<string, unknown>) => Promise<{ error?: string }>;
    };

    await expect(
      showView.execute({
        root: "card",
        elements: {
          card: {
            type: "ApprovalCard",
            props: { title: "Apply configuration?", body: "Ready to apply." },
          },
        },
      }),
    ).resolves.toEqual({
      error: expect.stringContaining("matching action tool"),
    });
  });

  it("uses caller-owned guaranteed view data when the model omits it", async () => {
    const forcedViewInput = {
      root: "form",
      elements: {
        form: {
          type: "GuidedForm",
          props: {
            title: "Project assessment",
            fields: [
              {
                name: "businessCriticality",
                label: "Business importance",
                description: "Explain the impact of downtime.",
                value: "",
              },
            ],
            submitLabel: "Start assessment",
          },
        },
      },
    };
    const tools = createUiTools({ forcedViewInput }) as Record<string, unknown>;
    const showView = tools.show_view as {
      execute: (value: Record<string, unknown>) => Promise<{
        ui?: unknown;
      }>;
    };

    const result = await showView.execute({
      root: "form",
      elements: {
        form: {
          type: "GuidedForm",
          props: {
            title: "Project assessment",
            fields: [
              { name: "businessCriticality", label: "Business importance" },
            ],
            submitLabel: "Start assessment",
          },
        },
      },
    });

    expect(JSON.stringify(result.ui)).toContain(
      "Explain the impact of downtime.",
    );
  });

  it("rejects non-actionable views when the turn requires a user decision", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
      requireInteractiveAction: true,
    }) as Record<string, unknown>;
    const showView = tools.show_view as {
      execute: (value: Record<string, unknown>) => Promise<{ error?: string }>;
    };

    await expect(
      showView.execute({
        root: "status",
        elements: {
          status: { type: "Text", props: { value: "loading" } },
        },
      }),
    ).resolves.toEqual({
      error: expect.stringContaining("interactive control"),
    });

    await expect(
      showView.execute({
        root: "decision",
        elements: {
          decision: {
            type: "DecisionCard",
            props: { title: "Create the issue?", body: "One-line change." },
          },
        },
      }),
    ).resolves.toMatchObject({ action: "render_view" });
  });

  it("rejects invalid specs with the offending element and prop", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const showView = tools.show_view as {
      execute: (value: Record<string, unknown>) => Promise<{ error?: string }>;
    };

    await expect(
      showView.execute({
        root: "a",
        elements: {
          a: { type: "DecisionCard", props: { heading: "wrong key" } },
        },
      }),
    ).resolves.toMatchObject({
      error: expect.stringContaining('element "a"'),
    });
  });

  it("advertises the spec envelope in the provider schema", async () => {
    const tools = createUiTools() as Record<string, unknown>;
    const showView = tools.show_view as {
      inputSchema: Parameters<typeof asSchema>[0];
    };

    const schema = await asSchema(showView.inputSchema).jsonSchema;

    expect(schema).toMatchObject({
      type: "object",
      required: ["root", "elements"],
    });
  });

  it("advertises definition components in the element type enum", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const showView = tools.show_view as {
      inputSchema: Parameters<typeof asSchema>[0];
    };

    const schema = (await asSchema(showView.inputSchema).jsonSchema) as {
      properties: {
        elements: {
          items: { properties: { type: { enum: string[] } } };
        };
      };
    };
    const typeEnum = schema.properties.elements.items.properties.type.enum;

    expect(typeEnum).toContain("DecisionCard");
    expect(typeEnum).toContain("Stack");
  });
});
