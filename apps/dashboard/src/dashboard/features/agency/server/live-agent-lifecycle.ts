import {
  createAgentState,
  createLoopDefinition,
  type AgentState,
  type LoopDefinition,
} from "@kody-ade/agency-domain";

export interface LiveAgentRecord {
  slug: string;
  title: string;
  body: string;
  primaryIntent?: string;
  capabilities?: string[];
  subagents?: string[];
  whenToUse?: string;
  sha?: string;
  updatedAt?: string;
  htmlUrl?: string;
}

export interface LiveIntentRecord {
  slug: string;
  body: string;
}

export interface LiveAgentDependencies {
  readAgent(agent: string): Promise<LiveAgentRecord | null>;
  readIntent(intent: string): Promise<LiveIntentRecord | null>;
  assignPrimaryIntent(agent: LiveAgentRecord, intent: string): Promise<unknown>;
  clearPrimaryIntent(agent: LiveAgentRecord): Promise<unknown>;
  readLoop(id: string): Promise<LoopDefinition | null>;
  saveLoop(loop: LoopDefinition): Promise<void>;
  deleteLoop(id: string): Promise<void>;
  readState(agent: string): Promise<AgentState | null>;
  saveState(state: AgentState): Promise<void>;
  resetState(agent: string): Promise<void>;
  now(): string;
}

export interface LiveAgentStatus {
  agent: string;
  live: boolean;
  paused: boolean;
  intent: string | null;
  schedule: string | null;
  loopId: string;
  state: AgentState | null;
  consistency: "ready" | "inactive" | "missing-state" | "missing-intent";
}

export function liveAgentLoopId(agent: string): string {
  return `live-agent-${agent}`;
}

function isLiveAgentLoop(
  loop: LoopDefinition | null,
  agent: string,
): loop is LoopDefinition {
  const target = loop?.target as { kind?: string; id?: string } | undefined;
  return Boolean(
    loop &&
      ((target?.kind === "capability" &&
        target.id === "live-agent" &&
        loop.input.agent === agent) ||
        (target?.kind === "agent" && target.id === agent)),
  );
}

export async function readLiveAgentStatus(
  agentSlug: string,
  deps: LiveAgentDependencies,
): Promise<LiveAgentStatus> {
  const loopId = liveAgentLoopId(agentSlug);
  const [agent, loop, state] = await Promise.all([
    deps.readAgent(agentSlug),
    deps.readLoop(loopId),
    deps.readState(agentSlug),
  ]);
  const agentLoop = isLiveAgentLoop(loop, agentSlug) ? loop : null;
  const intent =
    typeof agentLoop?.input.intent === "string"
      ? agentLoop.input.intent
      : agent?.primaryIntent ?? null;
  const relationReady = Boolean(agent && intent && agent.primaryIntent === intent);
  const consistency = !agentLoop
    ? "inactive"
    : !relationReady
      ? "missing-intent"
      : !state
        ? "missing-state"
        : "ready";
  return {
    agent: agentSlug,
    live: consistency === "ready",
    paused: Boolean(agentLoop && !agentLoop.enabled),
    intent,
    schedule:
      agentLoop?.trigger.type === "schedule" ? agentLoop.trigger.every : null,
    loopId,
    state,
    consistency,
  };
}

export async function activateLiveAgent(
  input: { agent: string; intent: string; every: string },
  deps: LiveAgentDependencies,
): Promise<LiveAgentStatus> {
  const [agent, intent] = await Promise.all([
    deps.readAgent(input.agent),
    deps.readIntent(input.intent),
  ]);
  if (!agent) throw new Error(`Agent not found: ${input.agent}`);
  if (!intent) throw new Error(`Intent not found: ${input.intent}`);
  const loopId = liveAgentLoopId(input.agent);
  const existingLoop = await deps.readLoop(loopId);
  if (
    existingLoop &&
    !isLiveAgentLoop(existingLoop, input.agent)
  ) {
    throw new Error(`The reserved Loop id "${loopId}" is already in use`);
  }

  const state = createAgentState({
    version: 1,
    agent: input.agent,
    revision: 0,
    cursor: "",
    summary: "",
    data: {},
    updatedAt: deps.now(),
  });
  const loop = createLoopDefinition({
    id: loopId,
    trigger: { type: "schedule", every: input.every },
    target: { kind: "capability", id: "live-agent" },
    input: { agent: input.agent, intent: input.intent },
    enabled: true,
  });

  const existingState = await deps.readState(input.agent);
  await deps.assignPrimaryIntent(agent, input.intent);
  try {
    if (!existingState) await deps.saveState(state);
    await deps.saveLoop(loop);
  } catch (error) {
    if (!existingState) await deps.resetState(input.agent);
    if (agent.primaryIntent) {
      await deps.assignPrimaryIntent(agent, agent.primaryIntent);
    } else {
      await deps.clearPrimaryIntent(agent);
    }
    throw error;
  }
  return {
    agent: input.agent,
    live: true,
    paused: false,
    intent: input.intent,
    schedule: input.every,
    loopId,
    state: existingState ?? state,
    consistency: "ready",
  };
}

export async function setLiveAgentPaused(
  agent: string,
  paused: boolean,
  deps: LiveAgentDependencies,
): Promise<void> {
  const loop = await deps.readLoop(liveAgentLoopId(agent));
  if (!isLiveAgentLoop(loop, agent)) {
    throw new Error(`Live Agent Loop not found: ${agent}`);
  }
  await deps.saveLoop(createLoopDefinition({ ...loop, enabled: !paused }));
}

export async function deactivateLiveAgent(
  agentSlug: string,
  deps: LiveAgentDependencies,
): Promise<void> {
  const agent = await deps.readAgent(agentSlug);
  if (!agent) throw new Error(`Agent not found: ${agentSlug}`);
  const loop = await deps.readLoop(liveAgentLoopId(agentSlug));
  if (isLiveAgentLoop(loop, agentSlug)) {
    await deps.deleteLoop(loop.id);
  }
  await deps.resetState(agentSlug);
  await deps.clearPrimaryIntent(agent);
}
