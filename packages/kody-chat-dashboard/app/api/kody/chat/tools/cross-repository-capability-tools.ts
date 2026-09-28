import { tool } from "ai";
import { z } from "zod";

const repositorySchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
});

const slugSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);

type RepositoryRef = z.infer<typeof repositorySchema>;
type Permission = "read" | "write";
type JsonObject = Record<string, unknown>;

interface RepositoryCapabilityAccess extends RepositoryRef {
  actorGithubId: number;
  readCapability(slug: string): Promise<JsonObject>;
  saveCapability(input: {
    slug: string;
    instructions: string;
    contract: string | null;
    skills: Array<{ path: string; content: string }>;
    tools: Array<{ path: string; content: string }>;
  }): Promise<JsonObject>;
}

interface Ctx {
  repositories: RepositoryRef[];
  actorGithubId: number;
  resolveRepository(
    repository: RepositoryRef,
    permission: Permission,
  ): Promise<RepositoryCapabilityAccess | null>;
}

function repositoryKey(repository: RepositoryRef): string {
  return `${repository.owner}/${repository.repo}`;
}

function record(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function capabilityFromResult(result: JsonObject): JsonObject | null {
  return record(result.capability);
}

function copyInput(capability: JsonObject, slug: string) {
  const instructions = capability.instructions;
  if (typeof instructions !== "string" || !instructions.trim()) return null;
  const contract = capability.contract;
  if (contract !== null && typeof contract !== "string") return null;
  const skills = Array.isArray(capability.skills)
    ? capability.skills.flatMap((value) => {
        const skill = record(value);
        return typeof skill?.name === "string" && typeof skill.body === "string"
          ? [{ path: skill.name, content: skill.body }]
          : [];
      })
    : [];
  const tools = Array.isArray(capability.capabilityTools)
    ? capability.capabilityTools.flatMap((value) => {
        const capabilityTool = record(value);
        return typeof capabilityTool?.name === "string" &&
          typeof capabilityTool.content === "string"
          ? [{ path: capabilityTool.name, content: capabilityTool.content }]
          : [];
      })
    : [];
  return { slug, instructions, contract, skills, tools };
}

async function authorizedRepository(
  ctx: Ctx,
  repository: RepositoryRef,
  permission: Permission,
  role: "source" | "target",
) {
  const connected = ctx.repositories.some(
    (candidate) =>
      candidate.owner.toLowerCase() === repository.owner.toLowerCase() &&
      candidate.repo.toLowerCase() === repository.repo.toLowerCase(),
  );
  if (!connected) return { error: `${role}_repository_not_connected` } as const;
  const access = await ctx.resolveRepository(repository, permission);
  if (!access)
    return { error: `${role}_${permission}_access_required` } as const;
  if (access.actorGithubId !== ctx.actorGithubId) {
    return { error: "repository_actor_mismatch" } as const;
  }
  return { access } as const;
}

export function createCrossRepositoryCapabilityTools(ctx: Ctx) {
  return {
    list_connected_repositories: tool({
      description:
        "List repositories connected to the signed-in account. Returns names only and never returns credentials.",
      inputSchema: z.object({}),
      execute: async () => ({ repositories: ctx.repositories }),
    }),

    read_connected_capability: tool({
      description:
        "Read one Capability from an explicitly selected connected repository. Use this for a cross-repository source read.",
      inputSchema: z.object({
        repository: repositorySchema,
        slug: slugSchema,
      }),
      execute: async ({ repository, slug }) => {
        const resolved = await authorizedRepository(
          ctx,
          repository,
          "read",
          "source",
        );
        if ("error" in resolved) return resolved;
        return resolved.access.readCapability(slug);
      },
    }),

    copy_capability: tool({
      description:
        "Copy one complete Capability, with the same slug and every instruction, contract, skill, and tool file, from one connected repository to another. This operation requires approval and never silently overwrites the target.",
      inputSchema: z.object({
        source: repositorySchema,
        target: repositorySchema,
        slug: slugSchema,
        overwrite: z.boolean().default(false),
      }),
      execute: async ({ source, target, slug, overwrite }) => {
        if (
          repositoryKey(source).toLowerCase() ===
          repositoryKey(target).toLowerCase()
        ) {
          return { error: "source_and_target_must_differ" };
        }
        const sourceAccess = await authorizedRepository(
          ctx,
          source,
          "read",
          "source",
        );
        if ("error" in sourceAccess) return sourceAccess;
        const targetAccess = await authorizedRepository(
          ctx,
          target,
          "write",
          "target",
        );
        if ("error" in targetAccess) return targetAccess;

        const [sourceResult, targetResult] = await Promise.all([
          sourceAccess.access.readCapability(slug),
          targetAccess.access.readCapability(slug),
        ]);
        const capability = capabilityFromResult(sourceResult);
        if (!capability) return { error: "source_capability_not_found" };
        if (capabilityFromResult(targetResult) && !overwrite) {
          return {
            error: "target_exists",
            message: `Capability "${slug}" already exists in ${repositoryKey(target)}. Set overwrite to true only if the user explicitly asked to replace it.`,
          };
        }
        const input = copyInput(capability, slug);
        if (!input) return { error: "source_capability_invalid" };
        const saved = await targetAccess.access.saveCapability(input);
        if (typeof saved.error === "string") return saved;
        const verified = await targetAccess.access.readCapability(slug);
        const verifiedCapability = capabilityFromResult(verified);
        const verifiedInput = verifiedCapability
          ? copyInput(verifiedCapability, slug)
          : null;
        if (
          !verifiedInput ||
          JSON.stringify(verifiedInput) !== JSON.stringify(input)
        ) {
          return { error: "target_verification_failed" };
        }
        return {
          copied: true,
          slug,
          source: repositoryKey(source),
          target: repositoryKey(target),
        };
      },
    }),
  };
}
