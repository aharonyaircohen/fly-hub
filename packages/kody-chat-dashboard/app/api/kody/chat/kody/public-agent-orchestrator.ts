import {
  runPublicAgentAssignments,
  selectPublicAgentTools,
  type PublicAgentTaskResult,
} from "./public-agent-delegation";
import type { PublicDelegationAgent } from "./public-agent-definition";
import type { PublicAgentRouteDecision } from "./public-agent-routing";

export interface PublicAgentCapability {
  slug?: string;
  instructions: string;
  capabilityTools: Array<{ name: string }>;
}

interface OrchestratePublicAgentTurnOptions {
  userText: string;
  assignedAgents: readonly PublicDelegationAgent[];
  availableTools: Record<string, unknown>;
  specialistTools?: Record<string, unknown>;
  outputToolNames: readonly string[];
  loadCapabilities(
    agent: PublicDelegationAgent,
  ): Promise<PublicAgentCapability[]>;
  route(input: {
    userText: string;
    assignedAgents: readonly PublicDelegationAgent[];
  }): Promise<PublicAgentRouteDecision>;
  invoke(input: {
    agent: PublicDelegationAgent;
    task: string;
    assignmentIndex: number;
    capabilities: PublicAgentCapability[];
    tools: Record<string, unknown>;
  }): Promise<PublicAgentTaskResult>;
}

function selectTools(
  availableTools: Record<string, unknown>,
  names: ReadonlySet<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(availableTools).filter(([name]) => names.has(name)),
  );
}

export async function orchestratePublicAgentTurn({
  userText,
  assignedAgents,
  availableTools,
  specialistTools = availableTools,
  outputToolNames,
  loadCapabilities,
  route,
  invoke,
}: OrchestratePublicAgentTurnOptions): Promise<{
  decision: PublicAgentRouteDecision;
  parentTools: Record<string, unknown>;
  results: PublicAgentTaskResult[];
}> {
  const capabilitiesByAgent = new Map(
    await Promise.all(
      assignedAgents.map(
        async (agent) => [agent.slug, await loadCapabilities(agent)] as const,
      ),
    ),
  );
  const decision = await route({ userText, assignedAgents });
  if (decision.mode === "self") {
    return {
      decision,
      // The route has already applied the parent's chat capability and every
      // host-level policy. Child ownership must not mutate that authorized
      // set; sharing a tool with a specialist is an explicit valid overlap.
      parentTools: { ...availableTools },
      results: [],
    };
  }

  const results = await runPublicAgentAssignments({
    assignments: decision.assignments,
    assignedAgents,
    invoke: async ({ agent, task, capability, assignmentIndex }) => {
      const allCapabilities = capabilitiesByAgent.get(agent.slug) ?? [];
      const selected = capability
        ? allCapabilities.find(({ slug }) => slug === capability)
        : null;
      if (capability && !selected) {
        throw new Error(`Assigned capability was not loaded: ${capability}`);
      }
      const baseSlug = `builtin-agent-${agent.slug}`;
      const capabilities = selected
        ? allCapabilities.filter(
            ({ slug }) => slug === baseSlug || slug === capability,
          )
        : allCapabilities;
      const tools = selectPublicAgentTools({
        availableTools: specialistTools,
        capabilityToolNames: capabilities.flatMap((capability) =>
          capability.capabilityTools.map((tool) => tool.name),
        ),
      });
      return invoke({ agent, task, assignmentIndex, capabilities, tools });
    },
  });
  const completed = results.some((result) => result.status === "completed");
  return {
    decision,
    parentTools: completed
      ? selectTools(availableTools, new Set(outputToolNames))
      : { ...availableTools },
    results,
  };
}
