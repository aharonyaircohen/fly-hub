/**
 * @testFramework vitest
 * @domain kody-chat
 */
import { describe, expect, it } from "vitest";
import { asSchema } from "ai";
import { createUiTools } from "../../../app/api/kody/chat/tools/ui-tools";
import { FINAL_ANSWER_TOOL } from "@dashboard/lib/chat-output-tools";
import { DASHBOARD_NAVIGATE_DIRECTIVE } from "@dashboard/lib/chat-ui-actions";
import type { ViewRendererDefinition } from "@dashboard/lib/view-renderers/renderers";

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
  });

  it("exposes a generic final output tool", () => {
    const tools = createUiTools() as Record<string, unknown>;
    expect(tools[FINAL_ANSWER_TOOL]).toBeTruthy();
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

  it("does not reclassify committed final text into a rendered view", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const finalAnswer = tools[FINAL_ANSWER_TOOL] as {
      execute: (value: { content: string }) => Promise<{ content?: string }>;
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

  it("keeps plain final answers for non-interactive text", async () => {
    const tools = createUiTools({
      viewRendererDefinitions: [decisionRenderer],
    }) as Record<string, unknown>;
    const finalAnswer = tools[FINAL_ANSWER_TOOL] as {
      execute: (value: { content: string }) => Promise<{ content?: string }>;
    };

    await expect(
      finalAnswer.execute({
        content:
          "The bug is in the login redirect handler. Would you like me to explain the failing path?",
      }),
    ).resolves.toEqual({
      content:
        "The bug is in the login redirect handler. Would you like me to explain the failing path?",
    });
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
    const typeEnum =
      schema.properties.elements.items.properties.type.enum;

    expect(typeEnum).toContain("DecisionCard");
    expect(typeEnum).toContain("Stack");
  });
});
