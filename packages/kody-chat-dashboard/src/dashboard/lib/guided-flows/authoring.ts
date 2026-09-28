import { getBuiltinViewRendererDefinition } from "../view-renderers/builtin";
import { VIEW_RENDERER_SLUG_RE } from "../view-renderers/definition";
import {
  type GuidedFlowActionDefinition,
  type GuidedFlowCommandStepDefinition,
  type GuidedFlowDefinition,
  type GuidedFlowNestedStepDefinition,
  type GuidedFlowViewStepDefinition,
} from "./controller";
import {
  GUIDED_FLOW_CONTROL_IDS,
  hasUniqueGuidedFlowControls,
} from "./control-contract";
import { z } from "zod";

const GUIDED_FLOW_ACTION_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const routeParametersSchema = z
  .record(z.string().trim().min(1).max(80), z.string().max(200))
  .optional();

const guidedFlowDraftStepBaseSchema = {
  title: z.string().trim().min(1).max(160),
  explanation: z.string().trim().min(1).max(1_000),
  routeId: z.string().trim().max(80).optional(),
  routeParameters: routeParametersSchema,
};

export const guidedFlowCmsItemsSourceSchema = z.object({
  type: z.literal("cms"),
  collection: z.string().trim().min(1).max(80),
  labelField: z.string().trim().min(1).max(80),
  valueField: z.string().trim().min(1).max(80),
  resultField: z.string().trim().min(1).max(80),
  filter: z
    .object({
      field: z.string().trim().min(1).max(80),
      fromResultField: z.string().trim().min(1).max(80),
    })
    .optional(),
});

export const guidedFlowFilePickerSchema = z.object({
  resultField: z.string().trim().min(1).max(80),
  extensions: z.array(z.string().trim().min(1).max(20)).max(20).optional(),
});

export const guidedFlowDraftViewStepSchema = z.object({
  ...guidedFlowDraftStepBaseSchema,
  type: z.literal("view").optional(),
  rendererSlug: z.string().trim().min(1).max(80),
  rendererVersion: z.number().int().positive().optional(),
  rendererData: z.record(z.string(), z.unknown()).optional(),
  itemsSource: guidedFlowCmsItemsSourceSchema.optional(),
  filePicker: guidedFlowFilePickerSchema.optional(),
  /** Raw editor input compiled into rendererData; never stored at runtime. */
  rendererDataJson: z.string().max(100_000).optional(),
  /** Widget/result signal that advances this authored view step. */
  completionActionId: z
    .string()
    .trim()
    .regex(GUIDED_FLOW_ACTION_ID_RE)
    .optional(),
});

export const guidedFlowDraftNestedStepSchema = z.object({
  ...guidedFlowDraftStepBaseSchema,
  type: z.literal("flow"),
  flowId: z.string().trim().min(1).max(80),
  flowVersion: z.number().int().positive(),
});

const SLASH_COMMAND_RE = /^\/[a-z][a-z0-9-]*(?:\s+[^\r\n]+)?$/i;

export const guidedFlowDraftCommandStepSchema = z.object({
  ...guidedFlowDraftStepBaseSchema,
  type: z.literal("command"),
  command: z.string().trim().min(2).max(200).regex(SLASH_COMMAND_RE),
  waitForCompletion: z.boolean().optional(),
});

export const guidedFlowDraftSchema = z.object({
  title: z.string().trim().min(1).max(160),
  completionRouteId: z.string().trim().max(80).optional(),
  completionRouteParameters: routeParametersSchema,
  controls: z
    .array(z.enum(GUIDED_FLOW_CONTROL_IDS))
    .max(8)
    .refine(hasUniqueGuidedFlowControls)
    .optional(),
  steps: z
    .array(
      z.union([
        guidedFlowDraftNestedStepSchema,
        guidedFlowDraftCommandStepSchema,
        guidedFlowDraftViewStepSchema,
      ]),
    )
    .min(1)
    .max(20),
});

export type GuidedFlowDraftViewStep = z.infer<
  typeof guidedFlowDraftViewStepSchema
>;
export type GuidedFlowDraftNestedStep = z.infer<
  typeof guidedFlowDraftNestedStepSchema
>;
export type GuidedFlowDraftCommandStep = z.infer<
  typeof guidedFlowDraftCommandStepSchema
>;
export type GuidedFlowDraftStep = z.infer<
  typeof guidedFlowDraftSchema
>["steps"][number];
export type GuidedFlowDraft = z.infer<typeof guidedFlowDraftSchema>;

export type GuidedFlowDraftErrors = Partial<
  Record<"controls" | "title" | "steps", string>
>;

function normalizedRouteParameters(
  parameters: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (!parameters) return undefined;
  const entries = Object.entries(parameters).flatMap(([key, value]) => {
    const normalizedKey = key.trim();
    const normalizedValue = value.trim();
    return normalizedKey && normalizedValue
      ? [[normalizedKey, normalizedValue] as const]
      : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

const SUPPORTED_RENDERERS = [
  "approval-card",
  "guided-form",
  "selection-list",
  "multi-select-list",
] as const;

export function listAuthoringRendererSlugs(): readonly string[] {
  return SUPPORTED_RENDERERS.filter((slug) =>
    Boolean(getBuiltinViewRendererDefinition(slug)),
  );
}

export function validateGuidedFlowDraft(
  draft: GuidedFlowDraft,
): GuidedFlowDraftErrors {
  if (!draft.title.trim()) return { title: "Enter a flow name." };
  if (draft.steps.length === 0) return { steps: "Add at least one step." };
  if (draft.controls && !hasUniqueGuidedFlowControls(draft.controls)) {
    return { controls: "Choose each control only once." };
  }
  if (
    draft.steps.some((step) => !step.title.trim() || !step.explanation.trim())
  ) {
    return { steps: "Complete every step." };
  }
  if (
    draft.steps.some(
      (step) => step.type === "command" && !SLASH_COMMAND_RE.test(step.command),
    )
  ) {
    return { steps: "Enter one valid slash command for every command step." };
  }
  if (
    draft.steps.some(
      (step) =>
        step.type !== "flow" &&
        step.type !== "command" &&
        step.completionActionId !== undefined &&
        !GUIDED_FLOW_ACTION_ID_RE.test(step.completionActionId),
    )
  ) {
    return { steps: "Enter a valid finish signal for every widget." };
  }
  if (
    draft.steps.some(
      (step) =>
        step.type !== "flow" &&
        step.type !== "command" &&
        step.rendererDataJson !== undefined &&
        !parseRendererDataJson(step.rendererDataJson),
    )
  ) {
    return { steps: "Enter valid JSON for every widget input." };
  }
  if (
    !draft.steps.every((step) => {
      if (step.type === "flow") {
        return (
          Boolean(step.flowId.trim()) &&
          Number.isInteger(step.flowVersion) &&
          step.flowVersion > 0
        );
      }
      if (step.type === "command") return true;
      return (
        VIEW_RENDERER_SLUG_RE.test(step.rendererSlug) &&
        (step.rendererVersion === undefined ||
          (Number.isInteger(step.rendererVersion) && step.rendererVersion > 0))
      );
    })
  ) {
    return { steps: "Choose a valid renderer or nested flow for every step." };
  }
  return {};
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function parseRendererDataJson(source: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(source || "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function approvalActionsForGoal(
  goal: string,
  nextStepId?: string,
): {
  actions: Array<Record<string, string>>;
  flowActions: GuidedFlowActionDefinition[];
} {
  const normalizedGoal = goal.toLowerCase();
  const candidates = [
    { id: "confirm", label: "Confirm", pattern: /confirm|approve/ },
    { id: "decline", label: "Decline", pattern: /decline|reject|cancel/ },
    { id: "edit", label: "Edit", pattern: /edit|change/ },
    { id: "redo", label: "Redo", pattern: /redo|retry/ },
  ];
  const requested = candidates.filter(({ pattern }) =>
    pattern.test(normalizedGoal),
  );
  const actions = (
    requested.length > 0
      ? requested
      : [
          {
            id: "continue",
            label: nextStepId ? "Continue" : "Finish",
            pattern: /.*/,
          },
        ]
  ).map(({ id, label }, index) => ({
    id,
    label,
    response: id,
    variant: index === 0 ? "primary" : "secondary",
  }));
  return {
    actions,
    flowActions: actions.map((action) => ({
      id: action.id,
      target:
        action.id === "cancel"
          ? { type: "cancel" as const }
          : nextStepId
            ? { type: "step" as const, stepId: nextStepId }
            : { type: "complete" as const },
    })),
  };
}

export function deriveGuidedFlowRendererData(
  rendererSlug: string,
  goal: string,
): Record<string, unknown> {
  const normalizedGoal = goal.toLowerCase();
  if (
    rendererSlug === "guided-form" &&
    /(client|oauth|sign.?in|credentials?)/.test(normalizedGoal)
  ) {
    return {
      fields: [
        { name: "clientId", label: "Client ID", value: "" },
        {
          name: "clientSecret",
          label: "Client secret",
          value: "",
          inputType: "password",
        },
        { name: "issuer", label: "Issuer", value: "" },
      ],
    };
  }
  if (rendererSlug === "guided-form") {
    return {
      fields: [{ name: "response", label: "Your response", value: "" }],
    };
  }
  if (
    rendererSlug === "selection-list" ||
    rendererSlug === "multi-select-list"
  ) {
    const topic = goal
      .trim()
      .replace(/^(please\s+)?(select|choose|pick)\s+/i, "")
      .replace(/\s+(from|among|between)\s+.*$/i, "")
      .trim();
    const label = topic
      ? topic.charAt(0).toUpperCase() + topic.slice(1)
      : "Option";
    return {
      items: [1, 2, 3].map((number) => ({
        id: `option-${number}`,
        label: `${label} ${number}`,
      })),
    };
  }
  return {};
}

type LegacyGuidedFlowViewStepDefinition = Omit<
  GuidedFlowViewStepDefinition,
  "actions"
> & {
  readonly actions?: readonly GuidedFlowActionDefinition[];
  readonly transitions?: Readonly<Record<string, string>>;
  readonly allowedActions?: readonly string[];
};

type LegacyGuidedFlowNestedStepDefinition = Omit<
  GuidedFlowNestedStepDefinition,
  "actions"
> & {
  readonly actions?: readonly GuidedFlowActionDefinition[];
  readonly transitions?: Readonly<Record<string, string>>;
  readonly allowedActions?: readonly string[];
};

type LegacyGuidedFlowCommandStepDefinition = Omit<
  GuidedFlowCommandStepDefinition,
  "actions"
> & {
  readonly actions?: readonly GuidedFlowActionDefinition[];
  readonly transitions?: Readonly<Record<string, string>>;
  readonly allowedActions?: readonly string[];
};

export type LegacyGuidedFlowDefinition = Omit<GuidedFlowDefinition, "steps"> & {
  readonly steps: readonly (
    | LegacyGuidedFlowViewStepDefinition
    | LegacyGuidedFlowNestedStepDefinition
    | LegacyGuidedFlowCommandStepDefinition
  )[];
};

function inferredLegacyActionIds(
  step:
    | LegacyGuidedFlowViewStepDefinition
    | LegacyGuidedFlowNestedStepDefinition
    | LegacyGuidedFlowCommandStepDefinition,
): readonly string[] {
  if (step.allowedActions?.length) return step.allowedActions;
  const transitionIds = Object.keys(step.transitions ?? {});
  if (transitionIds.length) return transitionIds;
  if (step.type === "flow") return ["complete"];
  if (step.type === "command") return ["run", "continue"];
  const rendererActions = step.rendererData?.actions;
  if (Array.isArray(rendererActions)) {
    const ids = rendererActions.flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const id = (candidate as { id?: unknown }).id;
      return typeof id === "string" ? [id] : [];
    });
    if (ids.length) return ids;
  }
  if (
    step.rendererSlug === "guided-form" ||
    step.rendererSlug === "multi-select-list"
  ) {
    return ["submit"];
  }
  return ["continue"];
}

export function migrateLegacyGuidedFlowDefinition(
  definition: LegacyGuidedFlowDefinition,
): GuidedFlowDefinition {
  return {
    ...definition,
    steps: definition.steps.map((step) => {
      const { allowedActions, transitions, ...canonicalStep } = step;
      if (step.actions)
        return canonicalStep as typeof canonicalStep & {
          actions: readonly GuidedFlowActionDefinition[];
        };
      const actionIds = inferredLegacyActionIds(step).map((actionId) =>
        step.type !== "flow" &&
        step.type !== "command" &&
        step.rendererSlug === "multi-select-list" &&
        actionId === "continue"
          ? "submit"
          : actionId,
      );
      return {
        ...canonicalStep,
        actions: actionIds.map((actionId) => {
          const legacyActionId =
            actionId === "submit" && allowedActions?.includes("continue")
              ? "continue"
              : actionId;
          const nextStepId = transitions?.[legacyActionId];
          return {
            id: actionId,
            target:
              actionId === "cancel"
                ? { type: "cancel" as const }
                : nextStepId
                  ? { type: "step" as const, stepId: nextStepId }
                  : { type: "complete" as const },
          };
        }),
      };
    }),
  };
}

function rendererDataFor(
  step: GuidedFlowDraftViewStep,
  nextStepId?: string,
): Pick<GuidedFlowViewStepDefinition, "rendererData" | "actions"> {
  const body = step.explanation.trim();
  if (
    step.rendererDataJson !== undefined ||
    step.completionActionId !== undefined
  ) {
    const rendererData =
      step.rendererDataJson !== undefined
        ? parseRendererDataJson(step.rendererDataJson)
        : (step.rendererData ?? {});
    if (!rendererData) {
      throw new Error("Enter valid JSON for every widget input.");
    }
    return {
      rendererData,
      actions: [
        {
          id: step.completionActionId ?? "complete",
          target: nextStepId
            ? { type: "step", stepId: nextStepId }
            : { type: "complete" },
        },
      ],
    };
  }
  const generatedData =
    step.rendererData ?? deriveGuidedFlowRendererData(step.rendererSlug, body);
  if (step.rendererSlug === "approval-card") {
    const approval = approvalActionsForGoal(body, nextStepId);
    return {
      rendererData: {
        ...generatedData,
        title: step.title,
        actions: approval.actions,
      },
      actions: approval.flowActions,
    };
  }

  if (step.rendererSlug === "guided-form") {
    return {
      rendererData: {
        ...generatedData,
        title: step.title,
        submitLabel: nextStepId ? "Continue" : "Finish",
      },
      actions: [
        {
          id: "submit",
          target: nextStepId
            ? { type: "step", stepId: nextStepId }
            : { type: "complete" },
        },
      ],
    };
  }

  if (step.rendererSlug === "multi-select-list") {
    const items =
      Array.isArray(generatedData.items) && generatedData.items.length > 0
        ? generatedData.items
        : [{ id: "option-1", label: "Option 1" }];
    return {
      rendererData: {
        ...generatedData,
        title: step.title,
        items,
      },
      actions: [
        {
          id: "submit",
          target: nextStepId
            ? { type: "step", stepId: nextStepId }
            : { type: "complete" },
        },
      ],
    };
  }

  const items =
    Array.isArray(generatedData.items) && generatedData.items.length > 0
      ? generatedData.items
      : [{ id: "continue", label: "Finish", response: "continue" }];

  return {
    rendererData: {
      ...generatedData,
      title: step.title,
      items,
    },
    actions: [
      {
        id: "continue",
        target: nextStepId
          ? { type: "step", stepId: nextStepId }
          : { type: "complete" },
      },
    ],
  };
}

export function buildGuidedFlowDefinition(
  draft: GuidedFlowDraft,
  requestedId?: string,
  version = 1,
): GuidedFlowDefinition {
  const errors = validateGuidedFlowDraft(draft);
  if (Object.keys(errors).length > 0) {
    throw new Error(Object.values(errors)[0]);
  }

  const id = slugify(requestedId || draft.title);
  if (!id) throw new Error("Flow name must contain a letter or number.");
  const steps = draft.steps.map((step, index) => {
    const routeParameters = normalizedRouteParameters(step.routeParameters);
    const nextStepId =
      index < draft.steps.length - 1 ? `step-${index + 2}` : undefined;
    if (step.type === "flow") {
      return {
        id: `step-${index + 1}`,
        type: "flow" as const,
        title: step.title.trim(),
        explanation: step.explanation.trim(),
        ...(step.routeId?.trim() ? { routeId: step.routeId.trim() } : {}),
        ...(routeParameters ? { routeParameters } : {}),
        flowId: step.flowId.trim(),
        flowVersion: step.flowVersion,
        actions: [
          {
            id: "complete",
            target: nextStepId
              ? { type: "step" as const, stepId: nextStepId }
              : { type: "complete" as const },
          },
        ],
      };
    }
    if (step.type === "command") {
      return {
        id: `step-${index + 1}`,
        type: "command" as const,
        title: step.title.trim(),
        explanation: step.explanation.trim(),
        ...(step.routeId?.trim() ? { routeId: step.routeId.trim() } : {}),
        ...(routeParameters ? { routeParameters } : {}),
        command: step.command.trim(),
        ...(step.waitForCompletion ? { waitForCompletion: true } : {}),
        actions: [
          { id: "run", target: { type: "stay" as const } },
          {
            id: "continue",
            target: nextStepId
              ? { type: "step" as const, stepId: nextStepId }
              : { type: "complete" as const },
          },
        ],
      };
    }
    return {
      id: `step-${index + 1}`,
      title: step.title.trim(),
      explanation: step.explanation.trim(),
      ...(step.routeId?.trim() ? { routeId: step.routeId.trim() } : {}),
      ...(routeParameters ? { routeParameters } : {}),
      rendererSlug: step.rendererSlug,
      ...(step.itemsSource ? { itemsSource: step.itemsSource } : {}),
      ...(step.filePicker ? { filePicker: step.filePicker } : {}),
      ...(step.rendererVersion
        ? { rendererVersion: step.rendererVersion }
        : {}),
      ...rendererDataFor(step, nextStepId),
    };
  });

  const completionRouteParameters = normalizedRouteParameters(
    draft.completionRouteParameters,
  );
  return {
    id,
    version,
    title: draft.title.trim(),
    ...(draft.completionRouteId?.trim()
      ? { completionRouteId: draft.completionRouteId.trim() }
      : {}),
    ...(completionRouteParameters ? { completionRouteParameters } : {}),
    ...(draft.controls && draft.controls.length > 0
      ? { controls: [...draft.controls] }
      : {}),
    steps,
  };
}
