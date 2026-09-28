/**
 * @fileType util
 * @domain agent
 * @pattern chat-tools
 * @ai-summary Lifecycle chat tools for agentIdentity identities, complementing
 *   create_kody_agent (in agent-tools.ts): list, read, delete, and dispatch a
 *   one-off task to an agent via the agent-ask path. Kept separate from
 *   the create tool so the gap-analysis creation flow stays untouched.
 */
import { tool } from "ai";
import { z } from "zod";

interface Ctx {
  owner: string;
  repo: string;
  listAgents(): Promise<unknown>;
  readAgent(slug: string): Promise<unknown>;
  updateAgent(
    slug: string,
    input: {
      title?: string;
      body?: string;
      whenToUse?: string;
      capabilities?: string[];
      subagents?: string[];
    },
  ): Promise<unknown>;
  removeAgent(slug: string): Promise<unknown>;
  dispatchAgent(slug: string, message: string): Promise<unknown>;
}

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

export function createAgentAdminTools(ctx: Ctx) {
  const repoRef = `${ctx.owner}/${ctx.repo}`;

  return {
    list_agents: tool({
      description: `List local and active Store Agent identities in ${repoRef} through the Dashboard API.`,
      inputSchema: z.object({}),
      execute: async () => {
        return ctx.listAgents();
      },
    }),

    read_agent: tool({
      description: `Read one agentIdentity from ${repoRef} in full (the markdown body: intent, allowed commands, restrictions).`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        return ctx.readAgent(slug);
      },
    }),

    update_agent: tool({
      description: `Update one editable Agent in ${repoRef} through the Dashboard API. Built-in identities are locked; Kody accepts only additional subagent assignments.`,
      inputSchema: z
        .object({
          slug: z.string().min(1).max(64),
          title: z.string().trim().min(1).optional(),
          body: z.string().optional(),
          whenToUse: z.string().trim().max(500).optional(),
          capabilities: z.array(z.string().min(1).max(80)).max(50).optional(),
          subagents: z.array(z.string().min(1).max(64)).max(20).optional(),
        })
        .refine(
          (input) =>
            input.title !== undefined ||
            input.body !== undefined ||
            input.whenToUse !== undefined ||
            input.capabilities !== undefined ||
            input.subagents !== undefined,
          { message: "Provide at least one Agent field to update." },
        ),
      execute: async ({ slug, ...input }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        return ctx.updateAgent(slug, input);
      },
    }),

    delete_agent: tool({
      description: `Remove an Agent identity from ${repoRef} through the Dashboard API. A local Agent is deleted; a Store Agent is only detached from this repo.`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        return ctx.removeAgent(slug);
      },
    }),

    dispatch_agent: tool({
      description: `Send a one-off task to an agent in ${repoRef}. Posts \`@kody <slug> <message>\` to the control issue (the agent-ask path), so the agentIdentity runs once on this task. Use for "ask the qa-engineer to ...". Returns the comment URL.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
        message: z.string().min(1).max(8000),
      }),
      execute: async ({ slug, message }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        return ctx.dispatchAgent(slug, message);
      },
    }),
  };
}
