/**
 * @fileType tool
 * @domain kody
 * @pattern ai-sdk-tool
 * @ai-summary Agent-creation tool for the kody-direct chat agent. Calls the
 *   same authenticated Dashboard API used by the Agents page. An agent is a pure
 *   reusable IDENTITY: a markdown body describing intent, allowed commands,
 *   and restrictions. Agents have no schedule, no state, and no run/tick —
 *   they're agent identities referenced by other flows. Format mirrors the agent
 *   template (Agent / Allowed Commands / Restrictions).
 *
 *   The model should NOT call this on the first turn — it must gap-
 *   analyze and ask the user questions until the agentIdentity is well-specified.
 */
import { tool } from "ai";
import { z } from "zod";
import { normalizeAgentSlug } from "../../../../../src/dashboard/lib/agent-slug";

interface Ctx {
  owner: string;
  repo: string;
  createAgent(input: {
    slug: string;
    title: string;
    body: string;
    whenToUse?: string;
  }): Promise<unknown>;
}

interface AgentInput {
  title: string;
  slug?: string;
  purpose: string;
  whenToUse?: string;
  extraAllowedCommands?: string[];
  extraRestrictions?: string[];
}

/**
 * Render the default agentIdentity agent body. The model fills in the variable
 * parts (purpose, allowed commands, restrictions). An agent is a
 * reusable agentIdentity — no cadence, no state, no tick.
 */
function buildAgentBody(input: AgentInput): string {
  const extraCmds = input.extraAllowedCommands ?? [];
  const extraRest = input.extraRestrictions ?? [];

  let body = "";

  body += `## Agent\n\n`;
  body += `${input.purpose.trim()}\n\n`;

  body += `## Allowed Commands\n\n`;
  if (extraCmds.length > 0) {
    for (const cmd of extraCmds) body += `- ${cmd.trim()}\n`;
  } else {
    body += `- _Not specified_\n`;
  }
  body += `\n`;

  body += `## Restrictions\n\n`;
  if (extraRest.length > 0) {
    for (const r of extraRest) body += `- ${r.trim()}\n`;
  } else {
    body += `- _Not specified_\n`;
  }
  body += `\n`;

  return body;
}

export const createKodyAgentInputSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Human-readable agent title. Becomes the H1 of the agent file."),
  slug: z
    .string()
    .optional()
    .describe(
      "Optional file slug (lowercase letters, digits, dashes, underscores; max 64 chars). " +
        "If omitted, derived from the title.",
    ),
  purpose: z
    .string()
    .min(1)
    .describe(
      "One to three sentences describing the agentIdentity — what it is, what it does, " +
        "and how it should behave. No implementation details.",
    ),
  whenToUse: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe(
      "Plain-language guidance for when a parent Agent should delegate to this Agent. Required before assigning it as a subagent.",
    ),
  extraAllowedCommands: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Optional shell commands the agentIdentity may run (e.g. " +
        '"`gh pr list`", "`gh run list`"). Each item becomes a bullet under "Allowed Commands".',
    ),
  extraRestrictions: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional restriction bullets to append (e.g. "Never comment on PRs from this agent.").',
    ),
});

export function createAgentTools(ctx: Ctx) {
  const repoRef = `${ctx.owner}/${ctx.repo}`;

  return {
    create_kody_agent: tool({
      description:
        `Create a new Kody Agent member in ${repoRef} through the same authenticated Dashboard API used by the Agents page. An agent is a pure reusable identity — a ` +
        "markdown body describing intent, allowed commands, and restrictions. " +
        "Agents have no schedule, no state, and no run/tick; they're agent identities " +
        "referenced by other flows.\n\n" +
        "BEFORE CALLING: gather title, purpose, and (optionally) allowed " +
        "commands and restrictions. Ask the user clarifying questions in small " +
        "batches until the agentIdentity is well-specified — never invent behavior. " +
        "Call when the proposed markdown body is ready; the tool shows approval and executes only after the click.\n\n" +
        "Returns the new agent's slug, title, and Kody URL on success.",
      inputSchema: createKodyAgentInputSchema,
      execute: async (input) => {
        const slug = normalizeAgentSlug(input.slug ?? input.title);
        if (!slug || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug)) {
          return {
            error: "invalid_slug",
            message:
              "Agent slug must be lowercase letters, digits, dashes, or underscores (max 64 chars). " +
              `Got "${slug}".`,
          };
        }

        return ctx.createAgent({
          slug,
          title: input.title,
          body: buildAgentBody(input),
          ...(input.whenToUse ? { whenToUse: input.whenToUse } : {}),
        });
      },
    }),
  };
}
