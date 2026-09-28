import { describe, expect, it, vi } from "vitest";

import { presentPublicAgentResponse } from "../../app/api/kody/chat/kody/public-agent-presentation";

const assignedAgents = [
  {
    slug: "agency-specialist",
    title: "Agency Specialist",
    body: "Manages Agents, Workflows, Capabilities, Loops, Intents, and Todos.",
  },
];

const assignment = {
  agent: "agency-specialist",
  task: "Create a new Todo list.",
};

const results = [
  {
    status: "completed" as const,
    agent: "agency-specialist",
    result: "A Todo list requires a name before it can be created.",
    reference: "Todos are managed by Agency.",
  },
];

describe("public Agent parent presentation", () => {
  it("keeps approval-protected actions available after specialist research", async () => {
    const events: unknown[] = [];
    const fallbackView = vi.fn(async () => ({ action: "render_view" }));
    const approval = {
      action: "render_view",
      rendererSlug: "approval-card",
      id: "signed-create-chore",
    };
    const generate = vi.fn(async () => ({
      text: "",
      steps: [
        {
          toolCalls: [
            {
              toolCallId: "call-create-chore",
              toolName: "create_chore",
              input: { title: "Document the QA flow" },
            },
          ],
          toolResults: [
            {
              toolCallId: "call-create-chore",
              toolName: "create_chore",
              output: approval,
            },
          ],
        },
      ],
    }));

    await expect(
      presentPublicAgentResponse({
        userText: "Create the exact chore from the research now.",
        assignments: [assignment],
        assignedAgents,
        results,
        model: {} as never,
        tools: {
          final_answer: { description: "plain text" },
          show_view: {
            description: "render an interaction",
            execute: fallbackView,
          },
          create_chore: { description: "stage a chore for approval" },
          github_get_file: { description: "read a repository file" },
        },
        writer: { write: (event) => events.push(event) },
        providerCapabilities: {
          supportsRequiredToolChoice: false,
          supportsNamedToolChoice: false,
        },
        requireViewOutput: true,
        generate: generate as never,
      }),
    ).resolves.toBe("Interactive response presented.");

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: {
          show_view: expect.any(Object),
          create_chore: expect.any(Object),
        },
        system: expect.stringContaining(
          "call the matching approval-protected action",
        ),
      }),
    );
    const generatedOptions = (
      generate.mock.calls as unknown as Array<
        [{ tools?: Record<string, unknown> }]
      >
    )[0]?.[0];
    expect(generatedOptions?.tools).not.toHaveProperty("github_get_file");
    expect(fallbackView).not.toHaveBeenCalled();
    expect(events).toEqual([
      {
        type: "data-chat-output-contract",
        data: { mode: "exclusive-tool" },
      },
      {
        type: "tool-input-available",
        toolCallId: "call-create-chore",
        toolName: "create_chore",
        input: { title: "Document the QA flow" },
      },
      {
        type: "tool-output-available",
        toolCallId: "call-create-chore",
        output: approval,
      },
    ]);
  });

  it("uses Kody's show_view tool for missing Todo details", async () => {
    const events: unknown[] = [];
    const input = {
      root: "form",
      elements: {
        form: {
          type: "GuidedForm",
          props: {
            title: "Create Todo list",
            fields: [{ name: "name", label: "Name", value: "" }],
            submitLabel: "Create",
          },
        },
      },
    };
    const output = { action: "render_view", id: "todo-form" };
    const generate = vi.fn(async () => ({
      text: "",
      steps: [
        {
          toolCalls: [
            {
              toolCallId: "call-show-view",
              toolName: "show_view",
              input,
            },
          ],
          toolResults: [
            {
              toolCallId: "call-show-view",
              toolName: "show_view",
              input,
              output,
            },
          ],
        },
      ],
    }));

    await expect(
      presentPublicAgentResponse({
        userText: "can u create new todo",
        assignments: [assignment],
        assignedAgents,
        results,
        model: {} as never,
        tools: {
          final_answer: { description: "plain text" },
          show_view: { description: "render an interaction" },
        },
        writer: { write: (event) => events.push(event) },
        providerCapabilities: { supportsRequiredToolChoice: true },
        requireViewOutput: true,
        generate: generate as never,
      }),
    ).resolves.toBe("Interactive response presented.");

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        tools: { show_view: expect.any(Object) },
        toolChoice: { type: "tool", toolName: "show_view" },
        system: expect.stringContaining(
          "missing information, confirmation, choice, or editable values",
        ),
        messages: [
          expect.objectContaining({
            content: expect.stringContaining("## Specialist conclusions"),
          }),
        ],
      }),
    );
    const generatedOptions = (
      generate.mock.calls as unknown as Array<
        [
          {
            messages: Array<{ content: string }>;
            prepareStep?: (input: unknown) => unknown;
          },
        ]
      >
    )[0]?.[0];
    expect(generatedOptions?.messages[0]?.content).not.toContain(
      "Source status:",
    );
    const prepareStep = generatedOptions?.prepareStep;
    expect(
      prepareStep?.({
        steps: [
          {
            toolResults: [
              {
                toolName: "final_answer",
                output: { error: "Use show_view instead." },
              },
            ],
          },
        ],
      } as never),
    ).toMatchObject({
      activeTools: ["show_view"],
      toolChoice: { type: "tool", toolName: "show_view" },
      system: expect.stringContaining("Call show_view now"),
    });
    expect(
      prepareStep?.({
        steps: [
          {
            toolResults: [
              {
                toolName: "final_answer",
                output: {
                  error:
                    "This prose answer must end with one short, relevant follow-up question. Retry final_answer without adding or changing a renderer.",
                },
              },
            ],
          },
        ],
      } as never),
    ).toMatchObject({
      activeTools: ["final_answer"],
      system: expect.stringContaining("no follow-up question"),
    });
    expect(events).toEqual([
      {
        type: "data-chat-output-contract",
        data: { mode: "exclusive-tool" },
      },
      {
        type: "tool-input-available",
        toolCallId: "call-show-view",
        toolName: "show_view",
        input,
      },
      {
        type: "tool-output-available",
        toolCallId: "call-show-view",
        output,
      },
    ]);
  });

  it("uses Kody's final_answer tool for a plain delegated answer", async () => {
    const events: unknown[] = [];
    const input = { content: "Agency owns reusable operating definitions." };
    const output = { content: "Agency owns reusable operating definitions." };

    await expect(
      presentPublicAgentResponse({
        userText: "Explain Agency structure.",
        assignments: [assignment],
        assignedAgents,
        results,
        model: {} as never,
        tools: {
          final_answer: { description: "plain text" },
          show_view: { description: "render an interaction" },
        },
        writer: { write: (event) => events.push(event) },
        providerCapabilities: { supportsRequiredToolChoice: true },
        requireViewOutput: false,
        generate: vi.fn(async () => ({
          text: "",
          steps: [
            {
              toolCalls: [
                {
                  toolCallId: "call-final",
                  toolName: "final_answer",
                  input,
                },
              ],
              toolResults: [
                {
                  toolCallId: "call-final",
                  toolName: "final_answer",
                  input,
                  output,
                },
              ],
            },
          ],
        })) as never,
      }),
    ).resolves.toBe("Agency owns reusable operating definitions.");

    expect(events).toContainEqual({
      type: "tool-output-available",
      toolCallId: "call-final",
      output,
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: "text-start" }),
    );
  });

  it("renders the generic creation form when a model returns no tool call", async () => {
    const events: unknown[] = [];
    const generate = vi.fn(async () => ({ text: "Please provide a name." }));
    const execute = vi.fn(async () => ({
      action: "render_view",
      rendererSlug: "guided-form",
    }));

    await expect(
      presentPublicAgentResponse({
        userText: "can u create new todo",
        assignments: [assignment],
        assignedAgents,
        results,
        model: {} as never,
        tools: {
          final_answer: { description: "plain text" },
          show_view: { description: "render an interaction", execute },
        },
        writer: { write: (event) => events.push(event) },
        providerCapabilities: {
          supportsRequiredToolChoice: false,
          supportsNamedToolChoice: false,
        },
        requireViewOutput: true,
        generate: generate as never,
      }),
    ).resolves.toBe("Interactive response presented.");

    expect(generate).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledWith({
      root: "form",
      elements: {
        form: {
          type: "GuidedForm",
          props: {
            title: "Create Todo",
            fields: [{ name: "name", label: "Name", value: "" }],
            submitLabel: "Create",
          },
        },
      },
    });
    expect(events).toEqual([
      {
        type: "data-chat-output-contract",
        data: { mode: "exclusive-tool" },
      },
      expect.objectContaining({
        type: "tool-input-available",
        toolName: "show_view",
      }),
      expect.objectContaining({
        type: "tool-output-available",
        output: {
          action: "render_view",
          rendererSlug: "guided-form",
        },
      }),
    ]);
  });

  it("publishes only the final successful presentation result", async () => {
    const events: unknown[] = [];
    const first = { content: "Draft answer." };
    const final = { content: "Final answer." };

    await presentPublicAgentResponse({
      userText: "Explain Agency structure.",
      assignments: [assignment],
      assignedAgents,
      results,
      model: {} as never,
      tools: {
        final_answer: { description: "plain text" },
        show_view: { description: "render an interaction" },
      },
      writer: { write: (event) => events.push(event) },
      providerCapabilities: { supportsRequiredToolChoice: true },
      requireViewOutput: false,
      generate: vi.fn(async () => ({
        text: "",
        steps: [
          {
            toolCalls: [
              { toolCallId: "first", toolName: "final_answer", input: first },
            ],
            toolResults: [
              {
                toolCallId: "first",
                toolName: "final_answer",
                input: first,
                output: first,
              },
            ],
          },
          {
            toolCalls: [
              { toolCallId: "final", toolName: "final_answer", input: final },
            ],
            toolResults: [
              {
                toolCallId: "final",
                toolName: "final_answer",
                input: final,
                output: final,
              },
            ],
          },
        ],
      })) as never,
    });

    expect(events).toContainEqual(
      expect.objectContaining({ toolCallId: "final", output: final }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ toolCallId: "first", output: first }),
    );
  });
});
