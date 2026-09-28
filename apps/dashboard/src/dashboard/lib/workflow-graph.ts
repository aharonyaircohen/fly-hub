import type {
  WorkflowDefinition,
  WorkflowInputBinding,
  WorkflowStepDefinition,
} from "./workflow-definitions";
import { WORKFLOW_END_STEP_ID } from "./workflow-definitions";
import { friendlyDecisionQuestion } from "./workflow-condition";

export interface WorkflowGraphNode {
  id: string;
  kind?: "capability" | "decision" | "terminal";
  capability?: string;
  question?: string;
  input?: unknown;
  inputs?: Record<string, WorkflowInputBinding>;
  approval?: "required";
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  when?: Record<string, unknown>;
  default?: boolean;
  maxIterations?: number;
}

export interface WorkflowGraph {
  startAt: string | null;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export function addWorkflowGraphStep(
  graph: WorkflowGraph,
  capability: string,
): WorkflowGraph {
  const usedIds = new Set(graph.nodes.map((node) => node.id));
  let id = capability;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${capability}-${suffix}`;
    suffix += 1;
  }
  const node: WorkflowGraphNode = { id, capability };
  const previous = [...graph.nodes]
    .reverse()
    .find(
      (candidate) =>
        candidate.kind !== "decision" && candidate.kind !== "terminal",
    );
  const canAppend =
    previous && !graph.edges.some((edge) => edge.source === previous.id);
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  let edgeId = previous ? `${previous.id}-${id}` : "";
  let edgeSuffix = 2;
  while (edgeIds.has(edgeId)) {
    edgeId = `${previous?.id ?? "step"}-${id}-${edgeSuffix}`;
    edgeSuffix += 1;
  }
  return {
    startAt: graph.startAt ?? id,
    nodes: [...graph.nodes, node],
    edges: canAppend
      ? [
          ...graph.edges,
          {
            id: edgeId,
            source: previous.id,
            target: id,
          },
        ]
      : graph.edges,
  };
}

export function removeWorkflowGraphNode(
  graph: WorkflowGraph,
  nodeId: string,
): WorkflowGraph {
  const removed = new Set([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      if (node.kind !== "decision" || removed.has(node.id)) continue;
      const incoming = graph.edges.some(
        (edge) =>
          edge.target === node.id &&
          !removed.has(edge.source) &&
          !removed.has(edge.target),
      );
      const outgoing = graph.edges.some(
        (edge) =>
          edge.source === node.id &&
          !removed.has(edge.source) &&
          !removed.has(edge.target),
      );
      if (!incoming || !outgoing) {
        removed.add(node.id);
        changed = true;
      }
    }
  }
  const nodes = graph.nodes.filter((node) => !removed.has(node.id));
  const edges = graph.edges.filter(
    (edge) => !removed.has(edge.source) && !removed.has(edge.target),
  );
  const startAt = nodes.some((node) => node.id === graph.startAt)
    ? graph.startAt
    : (nodes.find(
        (node) => node.kind !== "decision" && node.kind !== "terminal",
      )?.id ?? null);
  return { startAt, nodes, edges };
}

export function validateWorkflowGraph(graph: WorkflowGraph): string[] {
  const errors: string[] = [];
  const ids = graph.nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const startNode = graph.nodes.find((node) => node.id === graph.startAt);
  if (
    !graph.startAt ||
    !idSet.has(graph.startAt) ||
    startNode?.kind === "decision" ||
    startNode?.kind === "terminal"
  ) {
    errors.push("Choose a valid starting capability.");
  }
  if (idSet.size !== ids.length) {
    errors.push("Capability step IDs must be unique.");
  }
  const positions = new Map(
    graph.nodes
      .filter((node) => node.kind !== "decision" && node.kind !== "terminal")
      .map((node, index) => [node.id, index]),
  );
  const decisionIncoming = new Map<string, WorkflowGraphEdge>();
  for (const node of graph.nodes) {
    if (node.kind === "terminal") {
      if (graph.edges.some((edge) => edge.source === node.id)) {
        errors.push("The workflow end cannot connect to another step.");
      }
      continue;
    }
    if (node.kind !== "decision") continue;
    const incoming = graph.edges.filter((edge) => edge.target === node.id);
    if (incoming.length !== 1) {
      errors.push(`Decision ${node.id} needs one incoming connection.`);
    } else {
      decisionIncoming.set(node.id, incoming[0]!);
    }
    if (!graph.edges.some((edge) => edge.source === node.id)) {
      errors.push(`Decision ${node.id} needs at least one path.`);
    }
  }
  for (const edge of graph.edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) {
      errors.push(
        `Connection ${edge.source} → ${edge.target} points to a missing capability.`,
      );
      continue;
    }
    if (
      graph.nodes.find((node) => node.id === edge.target)?.kind === "decision"
    ) {
      continue;
    }
    const sourcePosition =
      graph.nodes.find((node) => node.id === edge.source)?.kind === "decision"
        ? positions.get(decisionIncoming.get(edge.source)?.source ?? "")
        : positions.get(edge.source);
    const targetPosition = positions.get(edge.target);
    if (
      sourcePosition !== undefined &&
      targetPosition !== undefined &&
      targetPosition <= sourcePosition &&
      edge.maxIterations === undefined
    ) {
      errors.push(
        `Backward connection ${edge.source} → ${edge.target} needs a maximum repeat count.`,
      );
    }
  }
  for (const node of graph.nodes) {
    if (
      graph.edges.filter((edge) => edge.source === node.id && edge.default)
        .length > 1
    ) {
      errors.push(
        `${node.kind === "decision" ? "Decision" : "Capability"} ${node.id} has more than one default connection.`,
      );
    }
  }
  return errors;
}

function questionFromCondition(condition?: Record<string, unknown>): string {
  return friendlyDecisionQuestion(condition);
}

function decisionIdFor(nodeId: string, usedIds: Set<string>): string {
  let id = `${nodeId}__decision`;
  let suffix = 2;
  while (usedIds.has(id)) {
    id = `${nodeId}__decision-${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return id;
}

function uniqueLegacyId(capability: string, seen: Map<string, number>): string {
  const count = (seen.get(capability) ?? 0) + 1;
  seen.set(capability, count);
  return count === 1 ? capability : `${capability}-${count}`;
}

export function workflowDefinitionGraph(
  workflow: WorkflowDefinition,
): WorkflowGraph {
  if (workflow.steps && workflow.steps.length > 0) {
    const baseNodes = workflow.steps.map((step) => ({
      id: step.id,
      capability: step.capability,
      ...(Object.prototype.hasOwnProperty.call(step, "input")
        ? { input: step.input }
        : {}),
      ...(step.inputs ? { inputs: step.inputs } : {}),
      ...(step.approval === "required" ? { approval: "required" as const } : {}),
    }));
    const usedIds = new Set(baseNodes.map((node) => node.id));
    const nodes: WorkflowGraphNode[] = [...baseNodes];
    const edges: WorkflowGraphEdge[] = [];
    for (const step of workflow.steps) {
      const outgoing = (step.next ?? []).map((next, index) => ({
        id: `${step.id}-${next.to}-${index}`,
        source: step.id,
        target: next.to,
        ...(next.when ? { when: next.when } : {}),
        ...(next.default ? { default: true } : {}),
        ...(next.maxIterations !== undefined
          ? { maxIterations: next.maxIterations }
          : {}),
      }));
      if (!outgoing.some((edge) => edge.when) && outgoing.length <= 1) {
        edges.push(...outgoing);
        continue;
      }
      const decisionId = decisionIdFor(step.id, usedIds);
      nodes.push({
        id: decisionId,
        kind: "decision",
        question: questionFromCondition(
          outgoing.find((edge) => edge.when)?.when,
        ),
      });
      edges.push({
        id: `${step.id}-${decisionId}`,
        source: step.id,
        target: decisionId,
      });
      edges.push(...outgoing.map((edge) => ({ ...edge, source: decisionId })));
    }
    if (
      edges.some((edge) => edge.target === WORKFLOW_END_STEP_ID) &&
      !nodes.some((node) => node.id === WORKFLOW_END_STEP_ID)
    ) {
      nodes.push({ id: WORKFLOW_END_STEP_ID, kind: "terminal" });
    }
    return {
      startAt: workflow.startAt ?? workflow.steps[0]?.id ?? null,
      nodes,
      edges,
    };
  }

  const seen = new Map<string, number>();
  const nodes = workflow.capabilities.map((capability) => ({
    id: uniqueLegacyId(capability, seen),
    capability,
  }));
  return {
    startAt: nodes[0]?.id ?? null,
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `${node.id}-${nodes[index + 1]!.id}`,
      source: node.id,
      target: nodes[index + 1]!.id,
    })),
  };
}

export function graphWorkflowDefinition(
  name: string,
  nodes: WorkflowGraphNode[],
  edges: WorkflowGraphEdge[],
  startAt: string | null,
): WorkflowDefinition {
  const now = new Date().toISOString();
  const capabilityNodes = nodes.filter(
    (node) => node.kind !== "decision" && node.kind !== "terminal",
  );
  const decisionNodes = nodes.filter((node) => node.kind === "decision");
  const foldedEdges: WorkflowGraphEdge[] = edges.filter(
    (edge) =>
      !decisionNodes.some(
        (node) => edge.source === node.id || edge.target === node.id,
      ),
  );
  for (const decision of decisionNodes) {
    const incoming = edges.find((edge) => edge.target === decision.id);
    if (!incoming) continue;
    for (const branch of edges.filter((edge) => edge.source === decision.id)) {
      foldedEdges.push({
        ...branch,
        id: `${incoming.source}-${branch.target}-${branch.id}`,
        source: incoming.source,
      });
    }
  }
  const decisionStart =
    nodes.find((node) => node.id === startAt)?.kind === "decision"
      ? (edges.find((edge) => edge.target === startAt)?.source ?? null)
      : startAt;
  const steps: WorkflowStepDefinition[] = capabilityNodes.map((node) => {
    const outgoing = foldedEdges.filter((edge) => edge.source === node.id);
    return {
      id: node.id,
      capability: node.capability ?? node.id,
      ...(Object.prototype.hasOwnProperty.call(node, "input")
        ? { input: node.input }
        : {}),
      ...(node.inputs ? { inputs: node.inputs } : {}),
      ...(node.approval === "required" ? { approval: "required" as const } : {}),
      ...(outgoing.length > 0
        ? {
            next: outgoing.map((edge) => ({
              to: edge.target,
              ...(edge.when ? { when: edge.when } : {}),
              ...(edge.default ? { default: true } : {}),
              ...(edge.maxIterations !== undefined
                ? { maxIterations: edge.maxIterations }
                : {}),
            })),
          }
        : {}),
    };
  });
  return {
    name: name.trim(),
    agent: "kody",
    capabilities: Array.from(
      new Set(capabilityNodes.map((node) => node.capability ?? node.id)),
    ),
    ...(decisionStart ? { startAt: decisionStart } : {}),
    steps,
    createdAt: now,
    updatedAt: now,
  };
}
