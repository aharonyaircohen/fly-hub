import {
  createAgencyRequestState,
  type AgencyRequestExecution,
  type AgencyRequestSource,
  type AgencyRequestState,
} from "@kody-ade/agency-domain";
import type { StrategyBlueprint } from "@kody-ade/engine-contracts";

export interface AgencyRequestTodoDraft {
  title: string;
  description: string;
  items: Array<{
    title: string;
    body: string;
    completed: boolean;
    meta: Record<string, unknown>;
  }>;
  agencyRequest: AgencyRequestState;
}

export interface AgencyRequestManagerPorts {
  findExisting(input: {
    blueprintId?: string;
    source: AgencyRequestSource;
  }): Promise<{ slug: string } | null>;
  create(input: AgencyRequestTodoDraft): Promise<{ slug: string }>;
  update(
    slug: string,
    input: AgencyRequestTodoDraft,
  ): Promise<{ slug: string }>;
  resolveBlueprint?(
    id: string,
  ): Promise<{ blueprint: StrategyBlueprint; instructions: string } | null>;
}

export interface SubmitAgencyRequestInput {
  blueprintId?: string;
  source: AgencyRequestSource;
  answers: Readonly<Record<string, unknown>>;
}

export interface AgencyRequestHandoff {
  type: "kody";
  message: string;
  displayContent: string;
}

export interface SubmitAgencyRequestResult {
  created: boolean;
  todoSlug: string;
  handoff: AgencyRequestHandoff;
}

function requestChecklist(
  hasBlueprint: boolean,
): AgencyRequestTodoDraft["items"] {
  const blueprintLabel = hasBlueprint ? " and Blueprint" : "";
  return [
    {
      title: `Validate the request${blueprintLabel}`,
      body: "Confirm the requested outcome, repository context, permissions, and success criteria.",
      completed: false,
      meta: { kind: "agency-request-validation" },
    },
    {
      title: "Prepare the repository-specific plan",
      body: "Inspect the repository and turn the request into a concrete execution plan.",
      completed: false,
      meta: { kind: "agency-request-plan" },
    },
    {
      title: "Activate the required automation",
      body: "Install or enable only the resources declared by the approved plan.",
      completed: false,
      meta: { kind: "agency-request-activation" },
    },
    {
      title: hasBlueprint ? "Run the Blueprint Workflow" : "Run the Workflow",
      body: "Execute the saved Workflow and keep every attempt in Run history.",
      completed: false,
      meta: { kind: "agency-request-execution" },
    },
    {
      title: "Verify the result end to end",
      body: "Check the saved success criteria against the real repository result.",
      completed: false,
      meta: { kind: "agency-request-verification" },
    },
    {
      title: "Publish the completion report",
      body: "Save the final state, evidence, and links in Reports.",
      completed: false,
      meta: { kind: "agency-request-report" },
    },
  ];
}

interface PreparedAgencyRequestPorts {
  read(slug: string): Promise<{
    slug: string;
    state: AgencyRequestState;
  } | null>;
  validateExecution(execution: AgencyRequestExecution): Promise<{
    execution: AgencyRequestExecution;
    issues: string[];
  }>;
  save(slug: string, state: AgencyRequestState): Promise<void>;
}

export async function assessPreparedAgencyRequest(
  slug: string,
  ports: PreparedAgencyRequestPorts,
) {
  const record = await ports.read(slug);
  if (!record) return { kind: "not-found" as const };
  const execution = record.state.execution;
  const relatedStrategy = record.state.related.find(
    (ref) => ref.kind === "strategy",
  );
  const inputBlueprintId =
    typeof execution?.input.blueprintId === "string"
      ? execution.input.blueprintId.trim()
      : "";
  const strategyId = relatedStrategy?.id ?? inputBlueprintId;
  if (!strategyId || !execution) {
    return { kind: "requires-reasoning" as const };
  }

  const validation = await ports.validateExecution(execution);
  if (validation.issues.length > 0) {
    const state = createAgencyRequestState({
      ...record.state,
      phase: "blocked",
      blockers: validation.issues,
    });
    await ports.save(slug, state);
    return { kind: "blocked" as const, issues: validation.issues };
  }

  const workflowId = validation.execution.workflowId;
  const activationIds = (validation.execution.activations ?? []).map(
    (activation) => `${activation.kind}:${activation.id}`,
  );
  const state = createAgencyRequestState({
    ...record.state,
    phase: "waiting-approval",
    questions: [],
    plan: [
      `Activate the approved Blueprint resources: ${activationIds.join(", ")}.`,
      `Run Workflow ${workflowId} with the saved Blueprint and repository request.`,
      "Monitor the Workflow until it reports end-to-end success or a precise blocker.",
    ],
    execution: validation.execution,
    evidence: [
      ...record.state.evidence,
      `Validated Strategy Blueprint ${strategyId} and Workflow ${workflowId}.`,
    ],
    blockers: [],
  });
  await ports.save(slug, state);
  return { kind: "ready" as const, workflowId };
}

function answer(
  answers: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = answers[key];
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 20_000) : undefined;
}

function handoff(
  todoSlug: string,
  source: AgencyRequestSource,
): AgencyRequestHandoff {
  const storeAuthorized = source.kind === "store-blueprint";
  const createsBlueprint =
    source.kind === "guided-flow" && source.flowId === "create-blueprint";
  return {
    type: "kody",
    displayContent: storeAuthorized
      ? "Applying Blueprint to this repository."
      : "Request submitted for assessment.",
    message: [
      `Agency request assessment handoff for Todo ${JSON.stringify(todoSlug)}.`,
      "Read the Todo and inspect the active repository, installed Store solutions, available Workflows, Triggers, Loops, tools, permissions, and success evidence.",
      createsBlueprint
        ? "Create and publish a reusable Store Strategy Blueprint from this request, including its instructions, application Workflow, compatibility, constraints, and end-to-end verification criteria. Then install and live-test it through the existing Agency request lifecycle."
        : "Preserve the requested outcome and use the existing Agency request lifecycle.",
      "When the Todo already contains a Strategy Blueprint execution, assess that saved Blueprint and preserve its Workflow, inputs, and activations; do not replace it with a different automation path.",
      "A Workflow named in execution.activations may intentionally be absent from the active Workflow list. Read that exact Workflow directly because Store candidates are readable before activation; do not block the request merely because the Workflow is not installed yet.",
      "Decide whether the request is clear and executable. Discover facts yourself. If a user decision is still required, update the request to waiting-information and ask only clear questions with the relevant context and choices.",
      "For default-branch CI requests, use the repository CI rollup rather than selecting a run from the raw Actions list; Kody orchestration runs are not repository CI.",
      storeAuthorized
        ? "The Store Apply click already authorized the Blueprint's declared actions. If it is executable, preserve the saved plan and execution, then dispatch it immediately without asking for another approval."
        : "If it is executable, save a concrete plan and the exact verified Workflow id and input in execution, update it to waiting-approval, and present one approval action. Do not make consequential changes before approval.",
      storeAuthorized
        ? "Attach the Run id, monitor its durable completion event, and mark the request done only with end-to-end evidence. Otherwise keep it active with the precise blocker or question."
        : "After approval, dispatch the saved Workflow once, attach its Run id, monitor its durable completion event, and mark the request done only with end-to-end evidence. Otherwise mark it blocked with the precise reason.",
    ].join("\n"),
  };
}

export async function submitAgencyRequest(
  input: SubmitAgencyRequestInput,
  ports: AgencyRequestManagerPorts,
): Promise<SubmitAgencyRequestResult> {
  const blueprintId = input.blueprintId?.trim();
  const resolved = blueprintId
    ? await ports.resolveBlueprint?.(blueprintId)
    : null;
  if (blueprintId && !resolved) {
    throw new Error(`Strategy Blueprint "${blueprintId}" is unavailable`);
  }
  const storeAuthorized = input.source.kind === "store-blueprint";
  const createsBlueprint =
    input.source.kind === "guided-flow" &&
    input.source.flowId === "create-blueprint";
  if (
    input.source.kind === "store-blueprint" &&
    input.source.blueprintId !== blueprintId
  ) {
    throw new Error(
      "Store Blueprint source does not match the requested Blueprint",
    );
  }
  const outcome =
    answer(input.answers, "desiredOutcome") ?? resolved?.blueprint.outcome;
  const source = createAgencyRequestState({
    phase: "assessing",
    source: input.source,
    requirement: {
      outcome: outcome ?? "Missing outcome",
    },
    questions: [],
    plan: [],
    evidence: [],
    blockers: [],
    related: [],
  }).source;
  if (!outcome) throw new Error("Agency request outcome is required");

  const requirement = {
    outcome,
    ...(answer(input.answers, "activation")
      ? { activation: answer(input.answers, "activation") }
      : {}),
    ...((answer(input.answers, "allowedActions") ??
    resolved?.blueprint.constraints.join("\n"))
      ? {
          permissions:
            answer(input.answers, "allowedActions") ??
            resolved!.blueprint.constraints.join("\n"),
        }
      : {}),
    ...((answer(input.answers, "successCriteria") ??
    resolved?.blueprint.verification.criteria.join("\n"))
      ? {
          success:
            answer(input.answers, "successCriteria") ??
            resolved!.blueprint.verification.criteria.join("\n"),
        }
      : {}),
    ...(answer(input.answers, "additionalContext")
      ? { context: answer(input.answers, "additionalContext") }
      : {}),
  };
  const agencyRequest = createAgencyRequestState({
    phase: storeAuthorized ? "waiting-approval" : "assessing",
    source,
    requirement,
    questions: [],
    plan: storeAuthorized
      ? [
          `Apply Strategy Blueprint ${resolved!.blueprint.id}.`,
          `Run Workflow ${resolved!.blueprint.application.workflowId}.`,
          "Monitor until the Blueprint verification criteria pass end to end.",
        ]
      : [],
    evidence: [],
    blockers: [],
    ...(resolved
      ? {
          execution: {
            workflowId: resolved.blueprint.application.workflowId,
            input: {
              ...(resolved.blueprint.application.workflowInput ?? {}),
              blueprintId: resolved.blueprint.id,
              blueprintVersion: resolved.blueprint.version,
              requestId:
                input.source.kind === "guided-flow"
                  ? input.source.effectId
                  : input.source.requestId,
              outcome,
              blueprint: resolved.blueprint,
              instructions: resolved.instructions,
              request: requirement,
            },
            activations: [
              {
                kind: "workflow",
                id: resolved.blueprint.application.workflowId,
              },
              ...resolved.blueprint.application.activate,
            ],
          },
        }
      : {}),
    related: resolved
      ? [
          { kind: "strategy", id: resolved.blueprint.id },
          {
            kind: "workflow",
            id: resolved.blueprint.application.workflowId,
          },
          ...resolved.blueprint.application.activate,
        ]
      : [],
  });
  const draft: AgencyRequestTodoDraft = {
    title: resolved
      ? `Build ${resolved.blueprint.name}`.slice(0, 160)
      : createsBlueprint
        ? `Create Blueprint: ${outcome}`.slice(0, 160)
        : outcome.slice(0, 160),
    description: storeAuthorized
      ? "Kody is applying this Store Blueprint and will keep its progress here."
      : createsBlueprint
        ? "Kody is creating a reusable Store Blueprint, then installing and testing it end to end."
      : "Kody is assessing this request before proposing execution.",
    items: requestChecklist(Boolean(resolved)),
    agencyRequest,
  };
  const existing = await ports.findExisting({
    ...(blueprintId ? { blueprintId } : {}),
    source,
  });
  if (existing) {
    const updated = await ports.update(existing.slug, draft);
    return {
      created: false,
      todoSlug: updated.slug,
      handoff: handoff(updated.slug, source),
    };
  }

  const created = await ports.create(draft);

  return {
    created: true,
    todoSlug: created.slug,
    handoff: handoff(created.slug, source),
  };
}
