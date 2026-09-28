import type { Octokit } from "@octokit/rest";
import { createAgentState, type AgentState } from "@kody-ade/agency-domain";
import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  readResolvedAgentFileForTenant,
  writeAgentFileForTenant,
  type AgentFile,
} from "@kody-ade/agency/agent-files";
import { readGuidanceFileForTenant } from "@kody-ade/workspace/guidance/files";
import {
  deleteRepositoryLoop,
  readRepositoryLoop,
  saveRepositoryLoop,
} from "@dashboard/lib/repository-loops";
import type {
  LiveAgentDependencies,
  LiveAgentRecord,
} from "./live-agent-lifecycle";
import { syncLoopWakeRegistration } from "./loop-wake-registration";

function writeAgentRelation(
  agent: LiveAgentRecord,
  tenantId: string,
  primaryIntent?: string,
) {
  const member = agent as unknown as AgentFile;
  return writeAgentFileForTenant(
    {
      slug: member.slug,
      title: member.title,
      body: member.body,
      capabilities: member.capabilities,
      subagents: member.subagents,
      whenToUse: member.whenToUse,
      ...(primaryIntent ? { primaryIntent } : {}),
    },
    tenantId,
  );
}

export function createLiveAgentDependencies(input: {
  octokit: Octokit;
  owner: string;
  repo: string;
}): LiveAgentDependencies {
  const tenantId = `${input.owner}/${input.repo}`;
  const backend = createBackendClient();
  return {
    readAgent: async (slug) =>
      (await readResolvedAgentFileForTenant(
        slug,
        tenantId,
        input.octokit,
      )) as LiveAgentRecord | null,
    readIntent: (slug) =>
      readGuidanceFileForTenant("intent", slug, tenantId),
    assignPrimaryIntent: (agent, intent) =>
      writeAgentRelation(agent, tenantId, intent),
    clearPrimaryIntent: (agent) => writeAgentRelation(agent, tenantId),
    readLoop: (id) =>
      readRepositoryLoop(input.octokit, input.owner, input.repo, id),
    saveLoop: async (loop) => {
      await saveRepositoryLoop(
        input.octokit,
        input.owner,
        input.repo,
        loop,
        `chore(kody): configure ${loop.id}`,
      );
      await syncLoopWakeRegistration({ owner: input.owner, repo: input.repo, loop });
    },
    deleteLoop: async (id) => {
      await deleteRepositoryLoop(
        input.octokit,
        input.owner,
        input.repo,
        id,
        `chore(kody): remove ${id}`,
      );
      await syncLoopWakeRegistration({
        owner: input.owner,
        repo: input.repo,
        loopId: id,
      });
    },
    readState: async (agent) => {
      const row = (await backend.query(backendApi.agentStates.get, {
        tenantId,
        agent,
      })) as { state?: unknown } | null;
      return row?.state ? createAgentState(row.state) : null;
    },
    saveState: async (state: AgentState) => {
      await backend.mutation(backendApi.agentStates.save, { tenantId, state });
    },
    resetState: async (agent) => {
      await backend.mutation(backendApi.agentStates.reset, { tenantId, agent });
    },
    now: () => new Date().toISOString(),
  };
}
