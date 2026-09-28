import { tool } from "ai";
import { z } from "zod";
import type { Octokit } from "@octokit/rest";
import { readableResourceResult } from "./readable-resource-result";
import {
  readUserBrowserGrant,
  USER_BROWSER_ACTIONS,
} from "@kody-ade/agency/capabilities";
import {
  PREVIEW_ACT_DIRECTIVE,
  type PreviewActDirective,
} from "../../../../../src/dashboard/lib/chat-ui-actions";

interface Ctx {
  octokit: Octokit;
  owner: string;
  repo: string;
  actorLogin?: string | null;
  listCapabilities(): Promise<unknown>;
  readCapability(slug: string): Promise<unknown>;
  saveCapability(input: {
    slug: string;
    instructions: string;
    contract: string;
    skills: Array<z.infer<typeof assetSchema>>;
    tools: Array<z.infer<typeof assetSchema>>;
  }): Promise<unknown>;
  removeCapability(slug: string): Promise<unknown>;
  runCapability(slug: string): Promise<unknown>;
}

const assetSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});

function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(slug);
}

const connectionIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);

const userBrowserActionSchema = z.enum(USER_BROWSER_ACTIONS);
const userBrowserRequirementsSchema = z.object({
  browser: z.literal(true),
  browserSession: z.literal("user"),
  browserActions: z.array(userBrowserActionSchema).min(1),
  browserOrigins: z.array(z.string().url()).min(1),
  browserFileRoots: z.array(z.string().min(1)).optional(),
});

const browserCapabilityActionFields = {
  slug: z.string().min(1).max(64),
  reason: z.string().min(1).max(200),
};

export const browserCapabilityActionSchema = z.discriminatedUnion("op", [
  z.object({
    ...browserCapabilityActionFields,
    op: z.literal("navigate"),
    url: z.string().url().max(4_096),
  }),
  z.object({
    ...browserCapabilityActionFields,
    op: z.literal("click"),
    selector: z.string().min(1).max(2_000),
  }),
  z.object({
    ...browserCapabilityActionFields,
    op: z.literal("fill"),
    selector: z.string().min(1).max(2_000),
    value: z.string().max(20_000),
  }),
  z.object({
    ...browserCapabilityActionFields,
    op: z.literal("upload"),
    selector: z.string().min(1).max(2_000),
    paths: z.array(z.string().min(1).max(500)).min(1).max(10),
  }),
  z.object({
    ...browserCapabilityActionFields,
    op: z.literal("scroll"),
    selector: z.string().min(1).max(2_000).optional(),
    dy: z.number().int().optional(),
  }),
  z.object({
    ...browserCapabilityActionFields,
    op: z.literal("wait"),
    ms: z.number().int().min(0).max(5_000).optional(),
  }),
]);

/**
 * Provider-facing schema. Some model providers do not reliably emit or
 * validate JSON Schema discriminated unions. Keep operation validation strict
 * on the server, but expose one stable object shape to the model.
 */
export const browserCapabilityActionInputSchema = z
  .object({
    ...browserCapabilityActionFields,
    op: userBrowserActionSchema,
    url: z.string().url().max(4_096).optional(),
    selector: z.string().min(1).max(2_000).optional(),
    value: z.string().max(20_000).optional(),
    paths: z.array(z.string().min(1).max(500)).min(1).max(10).optional(),
    dy: z.number().int().optional(),
    ms: z.number().int().min(0).max(5_000).optional(),
  })
  .superRefine((input, context) => {
    const required: Record<string, string[]> = {
      navigate: ["url"],
      click: ["selector"],
      fill: ["selector", "value"],
      upload: ["selector", "paths"],
    };
    for (const field of required[input.op] ?? []) {
      if (input[field as keyof typeof input] === undefined) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} is required for ${input.op}`,
        });
      }
    }
  });

function capabilityDetail(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const candidate = record.capability ?? record;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

function normalizedRepoPath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.length > 500 ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    return null;
  }
  return normalized;
}

function pathWithinRoots(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(`${root}/`));
}

export function createCapabilityTools(ctx: Ctx) {
  const { octokit, owner, repo } = ctx;
  const repoRef = `${owner}/${repo}`;

  return {
    read_capability_creation_guide: tool({
      description: "Read the Capability folder guide.",
      inputSchema: z.object({}),
      execute: async () => ({
        guide:
          'A Capability is one folder containing instructions.md, contract.json, skills/, and tools/. The contract declares execution as "agent" or "script" plus one JSON input and output. Script execution requires tools/run.sh and may declare exact Connection ids and secret names granted to that trusted process.',
      }),
    }),

    list_capabilities: tool({
      description: `List local and active Store Capabilities in ${repoRef} through the Dashboard API.`,
      inputSchema: z.object({}),
      execute: async () => ctx.listCapabilities(),
    }),

    read_capability: tool({
      description: `Read one Capability folder from ${repoRef}.`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        return readableResourceResult(await ctx.readCapability(slug));
      },
    }),

    browser_capability_act: tool({
      description:
        "Use one declared browser action from a Dashboard user-session Capability. " +
        "Call only after the user asks to run that Capability and after read_capability confirms its instructions. " +
        "The Dashboard owns the browser and returns a fresh page snapshot after each action. " +
        "This tool cannot publish, submit, or click outside the Capability's declared action and origin allowlists.",
      inputSchema: browserCapabilityActionInputSchema,
      execute: async (
        input,
      ): Promise<PreviewActDirective | { error: string }> => {
        const parsed = browserCapabilityActionSchema.safeParse(input);
        if (!parsed.success) return { error: "invalid_browser_action" };
        const action = parsed.data;
        if (!isValidSlug(action.slug))
          return { error: "invalid_capability_slug" };
        const detail = capabilityDetail(await ctx.readCapability(action.slug));
        const contract =
          typeof detail?.contract === "string" ? detail.contract : null;
        let grant;
        try {
          grant = readUserBrowserGrant(contract);
        } catch {
          return { error: "invalid_browser_capability_contract" };
        }
        if (!grant) return { error: "user_browser_not_declared" };
        if (!grant.actions.includes(action.op)) {
          return { error: "browser_action_not_allowed" };
        }
        if (action.op === "navigate") {
          const origin = new URL(action.url).origin;
          if (!grant.origins.includes(origin)) {
            return { error: "browser_origin_not_allowed" };
          }
        }
        let paths: string[] | undefined;
        if (action.op === "upload") {
          paths = action.paths
            .map(normalizedRepoPath)
            .filter((path): path is string => !!path);
          if (
            paths.length !== action.paths.length ||
            paths.some((path) => !pathWithinRoots(path, grant.fileRoots))
          ) {
            return { error: "browser_file_not_allowed" };
          }
        }
        const directive: PreviewActDirective = {
          action: PREVIEW_ACT_DIRECTIVE,
          capabilitySlug: action.slug,
          allowedOrigins: grant.origins,
          op: action.op,
          reason: action.reason,
        };
        switch (action.op) {
          case "navigate":
            directive.url = action.url;
            break;
          case "click":
            directive.selector = action.selector;
            break;
          case "fill":
            directive.selector = action.selector;
            directive.value = action.value;
            break;
          case "upload":
            directive.selector = action.selector;
            directive.paths = paths;
            break;
          case "scroll":
            directive.selector = action.selector;
            directive.dy = action.dy;
            break;
          case "wait":
            directive.ms = action.ms;
            break;
        }
        return directive;
      },
    }),

    create_or_update_capability: tool({
      description: `Create or replace one simple Capability folder in ${repoRef}.`,
      inputSchema: z.object({
        slug: z.string().min(1).max(64),
        instructions: z.string().min(1),
        contract: z
          .object({
            execution: z.enum(["agent", "script"]).default("agent"),
            requirements: userBrowserRequirementsSchema.optional(),
            connections: z.array(connectionIdSchema).optional(),
            secrets: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).optional(),
            timeoutMs: z.number().int().min(1_000).max(21_600_000).optional(),
            input: z.record(z.string(), z.unknown()),
            output: z.record(z.string(), z.unknown()),
          })
          .default({ execution: "agent", input: {}, output: {} }),
        skills: z.array(assetSchema).default([]),
        tools: z.array(assetSchema).default([]),
      }),
      execute: async (input) => {
        if (!isValidSlug(input.slug)) {
          return { error: `invalid slug "${input.slug}"` };
        }
        return ctx.saveCapability({
          slug: input.slug,
          instructions: input.instructions,
          contract: `${JSON.stringify(input.contract, null, 2)}\n`,
          skills: input.skills,
          tools: input.tools,
        });
      },
    }),

    delete_capability: tool({
      description: `Remove one Capability from ${repoRef} through the Dashboard API. A local capability is deleted; a Store capability is only detached from this repo.`,
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        return ctx.removeCapability(slug);
      },
    }),

    run_capability: tool({
      description:
        `Run one local or active Store Capability now as Kody in ${repoRef} through the Dashboard API. ` +
        "User-session browser Capabilities stay in this chat and return the browser action tool to use next instead of being dispatched to a background runner.",
      inputSchema: z.object({ slug: z.string().min(1).max(64) }),
      execute: async ({ slug }) => {
        if (!isValidSlug(slug)) return { error: `invalid slug "${slug}"` };
        const detail = capabilityDetail(await ctx.readCapability(slug));
        const contract =
          typeof detail?.contract === "string" ? detail.contract : null;
        let browserGrant;
        try {
          browserGrant = readUserBrowserGrant(contract);
        } catch {
          return { error: "invalid_browser_capability_contract" };
        }
        if (browserGrant) {
          return {
            ok: true,
            capability: slug,
            execution: "user_browser" as const,
            nextTool: "browser_capability_act" as const,
            instructions:
              typeof detail?.instructions === "string"
                ? detail.instructions
                : undefined,
            message:
              "Continue now in this chat with browser_capability_act. Do not dispatch this Capability or call run_capability again.",
          };
        }
        return ctx.runCapability(slug);
      },
    }),

    run_workflow_creator: tool({
      description: `Ask Kody to design a Workflow from an approved GitHub issue in ${repoRef}.`,
      inputSchema: z.object({ issue: z.number().int().positive() }),
      execute: async ({ issue }) => {
        const repoMeta = await octokit.rest.repos.get({ owner, repo });
        const ref = repoMeta.data.default_branch || "main";
        await octokit.rest.actions.createWorkflowDispatch({
          owner,
          repo,
          workflow_id: "kody.yml",
          ref,
          inputs: {
            capability: "workflow-creator",
            issue_number: String(issue),
          },
        });
        return {
          ok: true,
          workflowId: "kody.yml",
          capability: "workflow-creator",
          issue,
          ref,
        };
      },
    }),
  };
}
