export const EXECUTABLE_WORKFLOW_END = "$end";

export interface ExecutableWorkflowIssue {
  code: string;
  path: string;
  message: string;
}

export interface ExecutableWorkflowValidationOptions {
  knownCapabilities?: ReadonlySet<string>;
  capabilityInputs?: ReadonlyMap<string, ReadonlySet<string>>;
  capabilityOutputs?: ReadonlyMap<string, ReadonlySet<string>>;
  maxSteps?: number;
  maxTransitionsPerStep?: number;
  maxLoopIterations?: number;
}

type Raw = Record<string, unknown>;

const SAFE_CAPABILITY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const SAFE_STEP = /^[A-Za-z][A-Za-z0-9_-]*$/;
const SAFE_DATA_PATH =
  /^(facts|evidence|artifacts|result|workflow|lastOutcome)(?:\.[A-Za-z_][A-Za-z0-9_-]*)+$/;
const SAFE_INPUT_SOURCE =
  /^(?:workflow\.(?:input|facts|evidence)(?:\.[A-Za-z_][A-Za-z0-9_-]*)+|steps\.[A-Za-z][A-Za-z0-9_-]*\.result(?:\.[A-Za-z_][A-Za-z0-9_-]*)+)$/;

/**
 * The provider-neutral executable Workflow boundary shared by Store, clients,
 * and Engine. Product-specific fields may coexist; this validates only the
 * graph and capability contract required for execution.
 */
export function validateExecutableWorkflow(
  value: unknown,
  options: ExecutableWorkflowValidationOptions = {},
): ExecutableWorkflowIssue[] {
  const issues: ExecutableWorkflowIssue[] = [];
  const workflow = record(value);
  if (!workflow) {
    add(issues, "invalid_workflow", "workflow", "Workflow must be an object.");
    return issues;
  }

  const rawSteps = Array.isArray(workflow.steps) ? workflow.steps : [];
  if (rawSteps.length === 0) {
    add(issues, "steps_required", "steps", "Workflow must contain at least one step.");
    return issues;
  }
  const maxSteps = options.maxSteps ?? 100;
  if (rawSteps.length > maxSteps) {
    add(issues, "too_many_steps", "steps", `Workflow has ${rawSteps.length} steps; maximum is ${maxSteps}.`);
  }

  const declared = new Set(strings(workflow.capabilities));
  const steps = rawSteps.map(record);
  const ids: string[] = [];
  const idSet = new Set<string>();
  const capabilitiesByStep = new Map<string, string>();

  steps.forEach((step, index) => {
    const base = `steps[${index}]`;
    if (!step) {
      add(issues, "invalid_step", base, "Workflow step must be an object.");
      return;
    }
    const id = text(step.id);
    const capability = text(step.capability ?? step.action);
    if (!id || !SAFE_STEP.test(id)) {
      add(issues, "invalid_step_id", `${base}.id`, "Workflow step must have a valid id.");
    } else {
      if (idSet.has(id)) add(issues, "duplicate_step_id", `${base}.id`, `Step id ${id} is duplicated.`);
      idSet.add(id);
      ids.push(id);
      if (capability) capabilitiesByStep.set(id, capability);
    }
    if (!capability || !SAFE_CAPABILITY.test(capability)) {
      add(issues, "invalid_capability", `${base}.capability`, "Workflow step must name a valid capability.");
    } else {
      if (declared.size > 0 && !declared.has(capability)) {
        add(issues, "undeclared_capability", `${base}.capability`, `Capability ${capability} is not declared by this Workflow.`);
      }
      if (options.knownCapabilities && !options.knownCapabilities.has(capability)) {
        add(issues, "unknown_capability", `${base}.capability`, `Capability ${capability} is not available.`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(step, "input") && !isJsonValue(step.input)) {
      add(issues, "invalid_input", `${base}.input`, "Capability input must be one JSON value.");
    }
    if (step.input !== undefined && step.inputs !== undefined) {
      add(issues, "conflicting_inputs", base, "A step cannot use both fixed input and input mappings.");
    }
    validateBindings(
      step.inputs,
      `${base}.inputs`,
      issues,
      capability ? options.capabilityInputs?.get(capability) : undefined,
    );
    validateMatch(step.runWhen, `${base}.runWhen`, issues);
  });

  const startAt = text(workflow.startAt) ?? ids[0];
  if (!startAt || !idSet.has(startAt)) {
    add(issues, "missing_start_step", "startAt", `Start step ${startAt ?? "<none>"} does not exist.`);
  }

  const adjacency = new Map<string, string[]>();
  const explicitEnds = new Set<string>();
  steps.forEach((step, stepIndex) => {
    if (!step) return;
    const id = text(step.id);
    if (!id) return;
    adjacency.set(id, []);
    validateBindingSources(
      step.inputs,
      `steps[${stepIndex}].inputs`,
      issues,
      capabilitiesByStep,
      options.capabilityOutputs,
    );
    const transitions = list(step.next);
    const maxTransitions = options.maxTransitionsPerStep ?? 20;
    if (transitions.length > maxTransitions) {
      add(issues, "too_many_transitions", `steps[${stepIndex}].next`, `Step ${id} has more than ${maxTransitions} connections.`);
    }
    const parsed = transitions.map((item) => (typeof item === "string" ? { to: item } : record(item)));
    const defaults = parsed.filter((item) => item?.default === true);
    const unconditional = parsed.filter(
      (item) => item && item.when === undefined && item.default !== true && item.maxIterations === undefined,
    );
    if (defaults.length > 1) {
      add(issues, "multiple_default_transitions", `steps[${stepIndex}].next`, `Step ${id} has more than one Otherwise connection.`);
    }
    if (unconditional.length > 1 || (unconditional.length > 0 && transitions.length > 1)) {
      add(issues, "ambiguous_transition", `steps[${stepIndex}].next`, `Step ${id} mixes a direct connection with other choices.`);
    }

    parsed.forEach((transition, transitionIndex) => {
      const base = `steps[${stepIndex}].next[${transitionIndex}]`;
      if (!transition) {
        add(issues, "invalid_transition", base, "Workflow connection must be a step id or object.");
        return;
      }
      const target = text(transition.to);
      if (!target || (target !== EXECUTABLE_WORKFLOW_END && !SAFE_STEP.test(target))) {
        add(issues, "invalid_transition_target", `${base}.to`, "Workflow connection must name a valid target step.");
        return;
      }
      if (transition.default === true && transition.when !== undefined) {
        add(issues, "conflicting_transition", base, "A connection cannot be both conditional and Otherwise.");
      }
      validateMatch(
        transition.when,
        `${base}.when`,
        issues,
        options.capabilityOutputs?.get(text(step.capability ?? step.action) ?? ""),
      );
      if (target === EXECUTABLE_WORKFLOW_END) {
        explicitEnds.add(id);
        return;
      }
      const targetIndex = ids.indexOf(target);
      if (targetIndex < 0) {
        add(issues, "missing_transition_target", `${base}.to`, `Step ${id} connects to missing step ${target}.`);
      } else {
        adjacency.get(id)?.push(target);
      }
      const iterations = transition.maxIterations;
      if (targetIndex >= 0 && targetIndex <= stepIndex) {
        if (!Number.isInteger(iterations) || Number(iterations) < 1) {
          add(issues, "unbounded_loop", `${base}.maxIterations`, `Loop ${id} to ${target} needs a repeat limit.`);
        } else if (Number(iterations) > (options.maxLoopIterations ?? 100)) {
          add(issues, "loop_limit_too_high", `${base}.maxIterations`, `Loop repeat limit cannot exceed ${options.maxLoopIterations ?? 100}.`);
        }
      }
    });
  });

  if (startAt && idSet.has(startAt)) {
    const reachable = new Set<string>();
    const pending = [startAt];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      pending.push(...(adjacency.get(id) ?? []));
    }
    ids.forEach((id, index) => {
      if (!reachable.has(id)) add(issues, "unreachable_step", `steps[${index}]`, `Step ${id} can never run.`);
    });
    if (![...reachable].some((id) => (adjacency.get(id) ?? []).length === 0 || explicitEnds.has(id))) {
      add(issues, "missing_terminal_step", "steps", "Workflow has no reachable final step.");
    }
  }
  return issues;
}

export function formatExecutableWorkflowIssues(issues: readonly ExecutableWorkflowIssue[]): string[] {
  return issues.map((issue) => `${issue.path}: ${issue.message}`);
}

function validateBindings(
  value: unknown,
  path: string,
  issues: ExecutableWorkflowIssue[],
  declaredInputs?: ReadonlySet<string>,
): void {
  if (value === undefined) return;
  const bindings = record(value);
  if (!bindings || Object.keys(bindings).length === 0) {
    add(issues, "invalid_inputs", path, "Step inputs must contain at least one named mapping.");
    return;
  }
  for (const [name, raw] of Object.entries(bindings)) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(name)) add(issues, "invalid_input_name", `${path}.${name}`, `Input name ${name} is invalid.`);
    if (declaredInputs && !declaredInputs.has(name)) add(issues, "undeclared_input", `${path}.${name}`, `Target capability does not declare input ${name}.`);
    const binding = record(raw);
    const from = text(binding?.from);
    if (!binding || Object.keys(binding).some((field) => field !== "from") || !from || !SAFE_INPUT_SOURCE.test(from)) {
      add(issues, "invalid_input_source", `${path}.${name}.from`, "Input mapping must read Workflow data or a named step result.");
    }
  }
}

function validateBindingSources(
  value: unknown,
  path: string,
  issues: ExecutableWorkflowIssue[],
  capabilitiesByStep: ReadonlyMap<string, string>,
  outputs?: ReadonlyMap<string, ReadonlySet<string>>,
): void {
  const bindings = record(value);
  if (!bindings) return;
  for (const [name, raw] of Object.entries(bindings)) {
    const from = text(record(raw)?.from);
    if (!from?.startsWith("steps.")) continue;
    const parts = from.split(".");
    const sourceStep = parts[1];
    const capability = sourceStep ? capabilitiesByStep.get(sourceStep) : undefined;
    if (!sourceStep || !capability) {
      add(issues, "missing_input_step", `${path}.${name}.from`, `Input source references missing step ${sourceStep ?? "<none>"}.`);
      continue;
    }
    const outputPath = parts.slice(2).join(".");
    if (outputs?.get(capability) && !outputs.get(capability)?.has(outputPath)) {
      add(issues, "undeclared_step_output", `${path}.${name}.from`, `Step ${sourceStep} does not declare output ${outputPath}.`);
    }
  }
}

function validateMatch(
  value: unknown,
  path: string,
  issues: ExecutableWorkflowIssue[],
  outputs?: ReadonlySet<string>,
): void {
  if (value === undefined) return;
  const match = record(value);
  if (!match || Object.keys(match).length === 0) {
    add(issues, "invalid_condition", path, "Workflow condition must contain at least one match.");
    return;
  }
  for (const [field, expected] of Object.entries(match)) {
    if (!SAFE_DATA_PATH.test(field)) add(issues, "invalid_data_path", `${path}.${field}`, "Condition must use Workflow result data.");
    if (outputs && field.startsWith("result.") && !outputs.has(field)) add(issues, "undeclared_result_path", `${path}.${field}`, `Source capability does not declare ${field}.`);
    if (!isComparable(expected)) add(issues, "invalid_condition_value", `${path}.${field}`, "Condition value must be a JSON scalar.");
  }
}

function record(value: unknown): Raw | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function list(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function isComparable(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  return Array.isArray(value) && value.length > 0 && value.every((item) => isComparable(item) && !Array.isArray(item));
}

function isJsonValue(value: unknown): boolean {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return Boolean(value) && typeof value === "object" && Object.values(value as Raw).every(isJsonValue);
}

function add(issues: ExecutableWorkflowIssue[], code: string, path: string, message: string): void {
  issues.push({ code, path, message });
}
