export interface StrategyBlueprintIssue {
  code: string;
  path: string;
  message: string;
}

export type StrategyActivationKind =
  | "solution"
  | "trigger"
  | "loop"
  | "pipeline"
  | "workflow"
  | "capability"
  | "agent";

export interface StrategyBlueprint {
  schemaVersion: 1;
  kind: "strategy-blueprint";
  id: string;
  version: string;
  name: string;
  outcome: string;
  instructions: string;
  constraints: string[];
  application: {
    workflowId: string;
    workflowInput?: Record<string, unknown>;
    activate: Array<{ kind: StrategyActivationKind; id: string }>;
  };
  verification: { criteria: string[] };
  compatibility: { repositoryTypes: string[]; providers: string[] };
}

type Raw = Record<string, unknown>;

const SAFE_ID = /^[a-z][a-z0-9-]{0,127}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const ACTIVATION_KINDS = new Set<StrategyActivationKind>([
  "solution",
  "trigger",
  "loop",
  "pipeline",
  "workflow",
  "capability",
  "agent",
]);

/** Validate the small provider-neutral contract needed to apply a Strategy. */
export function validateStrategyBlueprint(
  value: unknown,
): StrategyBlueprintIssue[] {
  const issues: StrategyBlueprintIssue[] = [];
  const blueprint = record(value);
  if (!blueprint) {
    add(
      issues,
      "invalid_blueprint",
      "blueprint",
      "Blueprint must be an object.",
    );
    return issues;
  }

  if (blueprint.schemaVersion !== 1) {
    add(
      issues,
      "unsupported_schema",
      "schemaVersion",
      "Blueprint schemaVersion must be 1.",
    );
  }
  if (blueprint.kind !== "strategy-blueprint") {
    add(
      issues,
      "invalid_kind",
      "kind",
      'Blueprint kind must be "strategy-blueprint".',
    );
  }
  identifier(blueprint.id, "id", "invalid_id", issues);
  if (!text(blueprint.version) || !VERSION.test(String(blueprint.version))) {
    add(
      issues,
      "invalid_version",
      "version",
      "Blueprint version must use major.minor.patch.",
    );
  }
  requiredText(blueprint.name, "name", issues);
  requiredText(blueprint.outcome, "outcome", issues);
  requiredText(blueprint.instructions, "instructions", issues);
  nonEmptyStrings(blueprint.constraints, "constraints", issues);

  const application = record(blueprint.application);
  if (!application) {
    add(
      issues,
      "application_required",
      "application",
      "Blueprint application is required.",
    );
  } else {
    identifier(
      application.workflowId,
      "application.workflowId",
      "invalid_workflow_id",
      issues,
    );
    if (
      application.workflowInput !== undefined &&
      !record(application.workflowInput)
    ) {
      add(
        issues,
        "invalid_workflow_input",
        "application.workflowInput",
        "Blueprint Workflow input must be an object.",
      );
    }
    const activate = application.activate;
    if (!Array.isArray(activate)) {
      add(
        issues,
        "invalid_activations",
        "application.activate",
        "Blueprint activations must be an array.",
      );
    } else {
      activate.forEach((entry, index) => {
        const activation = record(entry);
        const kind = activation?.kind;
        const id = activation?.id;
        if (
          !activation ||
          typeof kind !== "string" ||
          !ACTIVATION_KINDS.has(kind as StrategyActivationKind) ||
          !text(id) ||
          !SAFE_ID.test(String(id))
        ) {
          add(
            issues,
            "invalid_activation",
            `application.activate[${index}]`,
            "Activation must name a supported Agency asset.",
          );
        }
      });
    }
  }

  const verification = record(blueprint.verification);
  if (!verification || !hasNonEmptyStrings(verification.criteria)) {
    add(
      issues,
      "verification_required",
      "verification.criteria",
      "Blueprint must define at least one success criterion.",
    );
  }

  const compatibility = record(blueprint.compatibility);
  if (!compatibility) {
    add(
      issues,
      "compatibility_required",
      "compatibility",
      "Blueprint compatibility is required.",
    );
  } else {
    nonEmptyStrings(
      compatibility.repositoryTypes,
      "compatibility.repositoryTypes",
      issues,
    );
    nonEmptyStrings(compatibility.providers, "compatibility.providers", issues);
  }
  return issues;
}

export function formatStrategyBlueprintIssues(
  issues: readonly StrategyBlueprintIssue[],
): string[] {
  return issues.map((issue) => `${issue.path}: ${issue.message}`);
}

function record(value: unknown): Raw | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Raw)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function identifier(
  value: unknown,
  path: string,
  code: string,
  issues: StrategyBlueprintIssue[],
): void {
  if (!text(value) || !SAFE_ID.test(String(value))) {
    add(issues, code, path, `${path} must be a valid identifier.`);
  }
}

function requiredText(
  value: unknown,
  path: string,
  issues: StrategyBlueprintIssue[],
): void {
  if (!text(value)) {
    add(issues, "field_required", path, `${path} is required.`);
  }
}

function hasNonEmptyStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim())
  );
}

function nonEmptyStrings(
  value: unknown,
  path: string,
  issues: StrategyBlueprintIssue[],
): void {
  if (!hasNonEmptyStrings(value)) {
    add(
      issues,
      "non_empty_list_required",
      path,
      `${path} must contain at least one value.`,
    );
  }
}

function add(
  issues: StrategyBlueprintIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}
