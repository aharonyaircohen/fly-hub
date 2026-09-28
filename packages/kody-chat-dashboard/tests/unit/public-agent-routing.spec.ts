import { describe, expect, it, vi } from "vitest";

import {
  MAX_PARALLEL_ASSIGNMENTS,
  buildPublicAgentRoutingPrompt,
  inferPublicAgentRouteFromDefinitions,
  routeProjectAssessmentSubmission,
  isBlueprintCreationIntakeRequest,
  isAgencyRequestIntakeRequest,
  isAgencyRequestAssessmentHandoff,
  getAgencyRequestAssessmentTodoSlug,
  isCompleteProjectAssessmentRequest,
  isClearlyConversationalTurn,
  isParentOwnedAgentManagementRequest,
  parsePublicAgentRouteDecision,
  routePublicAgentTask,
  shouldRoutePublicAgentChat,
} from "../../app/api/kody/chat/kody/public-agent-routing";

const assignedAgents = [
  {
    slug: "agency-specialist",
    title: "Agency Specialist",
    body: "Manages Agents, Workflows, Capabilities, Loops, and Todos.",
    whenToUse:
      "Use for AI Agency structure and governance across Agents, Capabilities, Workflows (including wf requests), Loops, Intents, and Todos.",
  },
  {
    slug: "repository-specialist",
    title: "Repository Specialist",
    body: "Investigates repository structure, code, commits, and pull requests.",
    whenToUse:
      "Use for repository structure, code, commits, and pull requests.",
  },
  {
    slug: "operations-specialist",
    title: "Operations Specialist",
    body: "Manage tasks, runs, CI, pull requests, releases, inbox items, reports, blockers, and operational status.",
    whenToUse: "Use for operational status, CI, releases, runs, and blockers.",
  },
  {
    slug: "experience-specialist",
    title: "Experience Specialist",
    body: "Explains Views, previews, guided flows, and user-interface behavior.",
    whenToUse: "Use for Views, previews, guided flows, and interface behavior.",
  },
  {
    slug: "knowledge-specialist",
    title: "Knowledge Specialist",
    body: "Retrieves memory, documentation, policies, context, and instructions.",
    whenToUse: "Use for memory, documentation, policies, and context.",
  },
];

describe("public Agent routing", () => {
  it("recognizes Blueprint creation without confusing it with Blueprint use", () => {
    expect(
      isBlueprintCreationIntakeRequest(
        "Create a reusable Web Release Blueprint for the Store.",
      ),
    ).toBe(true);
    expect(
      isBlueprintCreationIntakeRequest(
        "Build a Blueprint that keeps dependency updates healthy.",
      ),
    ).toBe(true);
    expect(
      isBlueprintCreationIntakeRequest(
        "Build repository-specific Healthy CI from the approved Blueprint.",
      ),
    ).toBe(false);
    expect(
      isBlueprintCreationIntakeRequest("Install the Healthy CI Blueprint."),
    ).toBe(false);
  });

  it("keeps Blueprint installation questions with parent Kody", async () => {
    const generate = vi.fn();
    await expect(
      routePublicAgentTask({
        userText:
          "Is any Blueprint installed in this repository, and what is maintaining it?",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({ mode: "self" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("honors an explicit request not to delegate", async () => {
    const generate = vi.fn();
    await expect(
      routePublicAgentTask({
        userText: "Do not delegate. Call guided_flow_create yourself.",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({ mode: "self" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps an explicit Capability invocation with parent Kody", async () => {
    const generate = vi.fn();
    await expect(
      routePublicAgentTask({
        userText:
          "Prepare the selected post for review. Use draft-facebook-personal-post. Do not click Post.",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({ mode: "self" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps durable automation ownership requests with Kody intake", async () => {
    expect(
      isAgencyRequestIntakeRequest(
        "Set up CI Repair for this repository and keep working until it passes end to end.",
      ),
    ).toBe(true);
    expect(
      isAgencyRequestIntakeRequest(
        "Build repository-specific Healthy CI from the approved Blueprint and keep monitoring it until it passes end to end.",
      ),
    ).toBe(true);
    expect(
      isAgencyRequestIntakeRequest("Run the CI Repair workflow on main."),
    ).toBe(false);

    const generate = vi.fn();
    await expect(
      routePublicAgentTask({
        userText:
          "Build an automation for releases and take responsibility for monitoring it.",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({ mode: "self" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps Agent management requests with Kody instead of a specialist", async () => {
    expect(
      isParentOwnedAgentManagementRequest(
        "Create a new Agent for local workflow checks.",
      ),
    ).toBe(true);

    const generate = vi.fn();
    await expect(
      routePublicAgentTask({
        userText:
          "Create a new Agent for local workflow checks and return its slug.",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({ mode: "self" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps the request manager assessment handoff with Kody", async () => {
    const handoff = 'Assess Agency Todo "keep-ci-passing" now.';
    expect(isAgencyRequestAssessmentHandoff(handoff)).toBe(true);
    expect(getAgencyRequestAssessmentTodoSlug(handoff)).toBe("keep-ci-passing");

    const generate = vi.fn();
    await expect(
      routePublicAgentTask({
        userText: handoff,
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({ mode: "self" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps a complete assessment with Kody until the context form is submitted", () => {
    expect(
      isCompleteProjectAssessmentRequest(
        "Run a complete project assessment for this repository.",
      ),
    ).toBe(true);
    expect(
      isCompleteProjectAssessmentRequest(
        'Start assessment.\n<view_result>{"teamSize":"3"}</view_result>',
      ),
    ).toBe(false);
    expect(isCompleteProjectAssessmentRequest("Assess the architecture.")).toBe(
      false,
    );
  });

  it("treats the opening assessment button as a request, not a submitted form", () => {
    expect(
      isCompleteProjectAssessmentRequest(
        'Run a complete deep project assessment for this repository.\n\n<view_result>{"kind":"view_result","view":"renderer","viewId":"chat-opening-session-1","rendererSlug":"guided-flow-status","actionId":"run-project-assessment"}</view_result>',
      ),
    ).toBe(true);
  });

  it("turns the submitted assessment form directly into ten CTO assignments", () => {
    const capabilities = [
      "assess-architecture",
      "assess-code-quality",
      "assess-security",
      "assess-test-reliability",
      "assess-delivery-system",
      "assess-operational-readiness",
      "assess-scalability",
      "assess-repository-history",
      "assess-team-capacity",
      "assess-continuous-product-qa",
    ];
    const decision = routeProjectAssessmentSubmission(
      '<view_result>{"projectExpectations":"grow","businessCriticality":"customer-facing; four hours downtime is acceptable","teamSizeAndRoles":"3 developers","relevantExperience":"senior web","systemKnowledge":"one original maintainer","maintenanceTime":"one day weekly"}</view_result>',
      [
        {
          slug: "cto",
          title: "CTO",
          body: "Assess project health.",
          capabilities: ["builtin-agent-cto", ...capabilities],
        },
      ],
    );

    expect(decision).toMatchObject({ mode: "delegate" });
    if (decision?.mode !== "delegate") return;
    expect(decision.assignments).toHaveLength(10);
    expect(decision.assignments[0]?.task).toContain("current repository");
    expect(decision.assignments.map(({ capability }) => capability)).toEqual(
      capabilities,
    );
  });

  it("requires all six user context answers before starting the assessment", () => {
    expect(
      routeProjectAssessmentSubmission(
        '<view_result>{"projectExpectations":"grow","teamSizeAndRoles":"3 developers","relevantExperience":"senior web","systemKnowledge":"one original maintainer","maintenanceTime":"one day weekly"}</view_result>',
        [
          {
            slug: "cto",
            title: "CTO",
            body: "Assess project health.",
            capabilities: ["assess-architecture"],
          },
        ],
      ),
    ).toBeNull();
  });

  it("accepts ten parallel assessment tasks for one specialist", () => {
    const capabilities = [
      "assess-architecture",
      "assess-code-quality",
      "assess-security",
      "assess-test-reliability",
      "assess-delivery-system",
      "assess-operational-readiness",
      "assess-scalability",
      "assess-repository-history",
      "assess-team-capacity",
      "assess-continuous-product-qa",
    ];
    const assessmentAgents = [
      {
        slug: "cto",
        title: "CTO",
        body: "Runs evidence-based project assessment tracks.",
        capabilities,
      },
    ];
    const assignments = capabilities.map((capability) => ({
      agent: "cto",
      capability,
      task: `Run ${capability}.`,
    }));

    expect(MAX_PARALLEL_ASSIGNMENTS).toBe(20);
    expect(
      parsePublicAgentRouteDecision(
        JSON.stringify({ mode: "delegate", assignments }),
        assessmentAgents,
      ),
    ).toEqual({ mode: "delegate", assignments });
    expect(buildPublicAgentRoutingPrompt(assessmentAgents)).toContain(
      "assess-team-capacity",
    );
    expect(buildPublicAgentRoutingPrompt(assessmentAgents)).toContain(
      "assess-continuous-product-qa",
    );
    expect(
      parsePublicAgentRouteDecision(
        JSON.stringify({
          mode: "delegate",
          assignments: [
            {
              agent: "cto",
              capability: "not-owned",
              task: "Run an unknown assessment.",
            },
          ],
        }),
        assessmentAgents,
      ),
    ).toEqual({ mode: "self" });
  });

  it("routes specialist work but keeps explicit presentation with Kody", () => {
    expect(
      shouldRoutePublicAgentChat({
        clientSurface: false,
        assignedSubagentCount: 2,
      }),
    ).toBe(true);
    expect(
      shouldRoutePublicAgentChat({
        clientSurface: true,
        assignedSubagentCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldRoutePublicAgentChat({
        clientSurface: false,
        assignedSubagentCount: 0,
      }),
    ).toBe(false);
    expect(
      shouldRoutePublicAgentChat({
        userText: "Provide the link to the CTO agent.",
        clientSurface: false,
        assignedSubagentCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldRoutePublicAgentChat({
        userText:
          "Render a compact visual card titled Renderer compatibility check with three steps: Alpha, Beta, Gamma. Do not start a Guided Flow. Use show_view.",
        clientSurface: false,
        assignedSubagentCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldRoutePublicAgentChat({
        userText:
          "In one short plain-text reply, state the selected repository. Do not create anything or take any action.",
        clientSurface: false,
        assignedSubagentCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldRoutePublicAgentChat({
        userText:
          "Explain what a repository is in two short sentences. Do not ask a follow-up question.",
        clientSurface: false,
        assignedSubagentCount: 2,
      }),
    ).toBe(false);
    expect(
      shouldRoutePublicAgentChat({
        userText:
          "Where is the repository settings page? Do not navigate there; just tell me the path.",
        clientSurface: false,
        assignedSubagentCount: 2,
      }),
    ).toBe(false);
  });

  it("builds routing guidance entirely from assigned Agent definitions", () => {
    const prompt = buildPublicAgentRoutingPrompt(assignedAgents);

    expect(prompt).toContain("agency-specialist");
    expect(prompt).toContain("Use for AI Agency structure and governance");
    expect(prompt).toContain("repository-specialist");
    expect(prompt).toContain("operations-specialist");
    expect(prompt).toContain("Use for operational status, CI");
    expect(prompt).toContain("assign the same Agent more than once");
  });

  it("accepts one or more assigned Agents with focused tasks", () => {
    expect(
      parsePublicAgentRouteDecision(
        JSON.stringify({
          mode: "delegate",
          assignments: [
            {
              agent: "agency-specialist",
              task: "Explain the configured Agency structure.",
            },
            {
              agent: "repository-specialist",
              task: "Identify the files that implement Agency.",
            },
          ],
        }),
        assignedAgents,
      ),
    ).toEqual({
      mode: "delegate",
      assignments: [
        {
          agent: "agency-specialist",
          task: "Explain the configured Agency structure.",
        },
        {
          agent: "repository-specialist",
          task: "Identify the files that implement Agency.",
        },
      ],
    });
  });

  it("reliably selects a clear domain using only configured definitions", () => {
    expect(
      inferPublicAgentRouteFromDefinitions(
        "Explain AI Agency structure.",
        assignedAgents,
      ),
    ).toEqual({
      mode: "delegate",
      assignments: [
        { agent: "agency-specialist", task: "Explain AI Agency structure." },
      ],
    });
    expect(
      inferPublicAgentRouteFromDefinitions(
        "Hello, how are you?",
        assignedAgents,
      ),
    ).toEqual({ mode: "self" });
    expect(
      inferPublicAgentRouteFromDefinitions(
        "What work is currently blocked?",
        assignedAgents,
      ),
    ).toEqual({
      mode: "delegate",
      assignments: [
        {
          agent: "operations-specialist",
          task: "What work is currently blocked?",
        },
      ],
    });
    expect(
      inferPublicAgentRouteFromDefinitions(
        "Explain the Agency structure and identify where it is implemented in this repository.",
        assignedAgents,
      ),
    ).toEqual({
      mode: "delegate",
      assignments: [
        {
          agent: "agency-specialist",
          task: "Complete only the part of this request owned by your configured definition: Explain the Agency structure and identify where it is implemented in this repository.",
        },
        {
          agent: "repository-specialist",
          task: "Complete only the part of this request owned by your configured definition: Explain the Agency structure and identify where it is implemented in this repository.",
        },
      ],
    });
  });

  it("keeps todo requests with the configured todo owner", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        mode: "delegate",
        assignments: [
          { agent: "agency-specialist", task: "Create the todo." },
          { agent: "experience-specialist", task: "Render the todo form." },
        ],
      }),
    }));

    await expect(
      routePublicAgentTask({
        userText: "Can you create a new todo?",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({
      mode: "delegate",
      assignments: [
        { agent: "agency-specialist", task: "Can you create a new todo?" },
      ],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["Explain AI Agency structure.", "agency-specialist"],
    ["Explain how this repository is structured.", "repository-specialist"],
    ["What work is currently blocked?", "operations-specialist"],
    ["What is the Views page used for?", "experience-specialist"],
    ["Which project policies should I follow?", "knowledge-specialist"],
  ])("routes %s to its configured domain owner", (prompt, agent) => {
    expect(
      inferPublicAgentRouteFromDefinitions(prompt, assignedAgents),
    ).toEqual({
      mode: "delegate",
      assignments: [{ agent, task: prompt }],
    });
  });

  it.each(["Hello", "Hi, what can you help me with?", "Thanks for the help"])(
    "recognizes conversational turns without domain work: %s",
    (prompt) => {
      expect(isClearlyConversationalTurn(prompt)).toBe(true);
    },
  );

  it("falls back to Kody when output is malformed or names no assigned Agent", () => {
    expect(parsePublicAgentRouteDecision("not json", assignedAgents)).toEqual({
      mode: "self",
    });
    expect(
      parsePublicAgentRouteDecision(
        '{"mode":"delegate","assignments":[{"agent":"unknown","task":"Do it"}]}',
        assignedAgents,
      ),
    ).toEqual({ mode: "self" });
  });

  it("routes with a tool-free model call and validates its result", async () => {
    const generate = vi.fn(async () => ({
      text: [
        "```json",
        JSON.stringify({
          mode: "delegate",
          assignments: [{ agent: "agency-specialist", task: "Explain Agency" }],
        }),
        "```",
      ].join("\n"),
    }));

    await expect(
      routePublicAgentTask({
        userText: "Help me understand this",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({
      mode: "delegate",
      assignments: [{ agent: "agency-specialist", task: "Explain Agency" }],
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
        model: {},
        messages: [{ role: "user", content: "Help me understand this" }],
        tools: undefined,
      }),
    );
  });

  it("uses semantic routing before the wording fallback", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        mode: "delegate",
        assignments: [
          { agent: "agency-specialist", task: "Explain AI Agency structure." },
        ],
      }),
    }));

    await expect(
      routePublicAgentTask({
        userText: "Explain AI Agency structure.",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({
      mode: "delegate",
      assignments: [
        {
          agent: "agency-specialist",
          task: "Explain AI Agency structure.",
        },
      ],
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("does not let a multi-agent model decision override one clear domain owner", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        mode: "delegate",
        assignments: [
          { agent: "agency-specialist", task: "Explain Agency." },
          { agent: "experience-specialist", task: "Render the explanation." },
        ],
      }),
    }));

    await expect(
      routePublicAgentTask({
        userText: "Explain AI Agency structure.",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({
      mode: "delegate",
      assignments: [
        { agent: "agency-specialist", task: "Explain AI Agency structure." },
      ],
    });
  });

  it("routes explicit Workflow execution to the operational owner", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        mode: "delegate",
        assignments: [
          { agent: "operations-specialist", task: "Run the merge workflow." },
        ],
      }),
    }));

    await expect(
      routePublicAgentTask({
        userText: "r u able to run merge wf?",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({
      mode: "delegate",
      assignments: [
        { agent: "operations-specialist", task: "r u able to run merge wf?" },
      ],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("routes a branch-only CI workflow run to one operational owner", async () => {
    const generate = vi.fn();

    await expect(
      routePublicAgentTask({
        userText:
          "Run the CI Repair workflow for branch main with run ID 31642789167 and no PR.",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({
      mode: "delegate",
      assignments: [
        {
          agent: "operations-specialist",
          task: "Run the CI Repair workflow for branch main with run ID 31642789167 and no PR.",
        },
      ],
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps a greeting with Kody without spending a routing model call", async () => {
    const generate = vi.fn();

    await expect(
      routePublicAgentTask({
        userText: "Hi, what can you help me with?",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({ mode: "self" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps architecture advice with Kody instead of misrouting generic system wording", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        mode: "delegate",
        assignments: [
          {
            agent: "system-admin",
            task: "Review configured chat models.",
          },
        ],
      }),
    }));
    const agentsWithSystemAdmin = [
      ...assignedAgents,
      {
        slug: "system-admin",
        title: "System Admin",
        body: "Manages models, secrets, variables, webhooks, and system settings.",
        whenToUse:
          "Use for models, secrets, variables, webhooks, and system settings.",
      },
    ];

    await expect(
      routePublicAgentTask({
        userText: "Should this project add another chat system?",
        assignedAgents: agentsWithSystemAdmin,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({ mode: "self" });
    await expect(
      routePublicAgentTask({
        userText: "How does Kody Chat work in this project?",
        assignedAgents: agentsWithSystemAdmin,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({ mode: "self" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("lets semantic meaning override misleading word overlap", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        mode: "delegate",
        assignments: [
          { agent: "experience-specialist", task: "Explain Views" },
        ],
      }),
    }));

    await expect(
      routePublicAgentTask({
        userText: "Explain what the Views page is used for.",
        assignedAgents,
        model: {} as never,
        generate: generate as never,
      }),
    ).resolves.toEqual({
      mode: "delegate",
      assignments: [
        {
          agent: "experience-specialist",
          task: "Explain Views",
        },
      ],
    });
    expect(generate).toHaveBeenCalledOnce();
  });

  it("includes recent conversation context for short follow-ups", async () => {
    const generate = vi.fn(async () => ({
      text: JSON.stringify({
        mode: "delegate",
        assignments: [
          { agent: "operations-specialist", task: "Check the CI blockers." },
        ],
      }),
    }));

    await routePublicAgentTask({
      userText: "Check it",
      conversationContext:
        "User: Is the latest deployment blocked by CI?\nAssistant: I can check.",
      assignedAgents,
      model: {} as never,
      generate: generate as never,
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: "user",
            content: expect.stringContaining(
              "Is the latest deployment blocked by CI?",
            ),
          },
        ],
      }),
    );
  });

  it("keeps Kody in control when the routing model fails", async () => {
    await expect(
      routePublicAgentTask({
        userText: "Explain Agency",
        assignedAgents,
        model: {} as never,
        generate: vi.fn(async () => {
          throw new Error("router unavailable");
        }) as never,
      }),
    ).resolves.toEqual({
      mode: "delegate",
      assignments: [{ agent: "agency-specialist", task: "Explain Agency" }],
    });
  });

  it("uses the wording fallback when semantic routing returns malformed output", async () => {
    await expect(
      routePublicAgentTask({
        userText: "Explain Agency",
        assignedAgents,
        model: {} as never,
        generate: vi.fn(async () => ({ text: "not json" })) as never,
      }),
    ).resolves.toEqual({
      mode: "delegate",
      assignments: [{ agent: "agency-specialist", task: "Explain Agency" }],
    });
  });
});
