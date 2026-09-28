import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getRequestAuth,
  getUserOctokit,
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
  verifyActorLogin,
} from "@kody-ade/base/auth";
import { normalizeSlug } from "@kody-ade/base/slug";
import { clearGitHubContext, setGitHubContext } from "../github";
import {
  deleteGuidanceFile,
  isValidGuidanceSlug,
  listGuidanceFiles,
  readGuidanceFile,
  type GuidanceKind,
  writeGuidanceFile,
} from "../guidance/files";

const AGENT_TOKEN_RE = /^(\*|[a-z0-9][a-z0-9_-]{0,63})$/;
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

const createSchema = z.object({
  slug: z.string().max(64).optional(),
  name: z.string().min(1).max(120).optional(),
  body: z.string().min(1).max(100_000),
  agent: z.array(z.string().regex(AGENT_TOKEN_RE)).min(1).default(["kody"]),
  actorLogin: z.string().optional(),
});

const updateSchema = z
  .object({
    body: z.string().min(1).max(100_000).optional(),
    agent: z.array(z.string().regex(AGENT_TOKEN_RE)).min(1).optional(),
    actorLogin: z.string().optional(),
  })
  .refine((value) => value.body !== undefined || value.agent !== undefined, {
    message: "At least one of `body` or `agent` must be provided.",
  });

function label(kind: GuidanceKind): string {
  if (kind === "constraint") return "Constraint";
  if (kind === "intent") return "Intent";
  return "Policy";
}

function setRequestContext(req: NextRequest): void {
  const auth = getRequestAuth(req);
  if (auth) setGitHubContext(auth.owner, auth.repo, auth.token);
}

async function requireMutationActor(
  req: NextRequest,
  actorLogin?: string,
): Promise<NextResponse | null> {
  const actor = await verifyActorLogin(req, actorLogin);
  if (actor instanceof NextResponse) return actor;
  if (!(await getUserOctokit(req))) {
    return NextResponse.json(
      {
        error: "no_user_token",
        message:
          "A signed-in GitHub token is required to change agent guidance.",
      },
      { status: 401 },
    );
  }
  return null;
}

function failure(
  kind: GuidanceKind,
  action: string,
  error: unknown,
): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      { error: "validation_error", details: error.issues },
      { status: 400 },
    );
  }
  console.error(`[${label(kind)}] ${action}:`, error);
  return NextResponse.json(
    {
      error: `${action.toLowerCase().replaceAll(" ", "_")}_failed`,
      message: `${action} failed.`,
    },
    { status: 500 },
  );
}

export function createGuidanceCollectionHandlers(kind: GuidanceKind) {
  return {
    async GET(req: NextRequest) {
      const auth = await verifyRepoReadAccess(req);
      if (auth instanceof NextResponse) return auth;
      setRequestContext(req);
      try {
        return NextResponse.json(
          { entries: await listGuidanceFiles(kind) },
          { headers: NO_STORE_HEADERS },
        );
      } catch (error) {
        return failure(kind, "List", error);
      } finally {
        clearGitHubContext();
      }
    },
    async POST(req: NextRequest) {
      const auth = await verifyRepoWriteAccess(req);
      if (auth instanceof NextResponse) return auth;
      setRequestContext(req);
      try {
        const payload = createSchema.parse(await req.json());
        const slug = normalizeSlug(payload.slug ?? payload.name ?? "", kind);
        if (!isValidGuidanceSlug(slug)) {
          return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
        }
        if (await readGuidanceFile(kind, slug)) {
          return NextResponse.json(
            {
              error: "slug_taken",
              message: `${label(kind)} "${slug}" already exists.`,
            },
            { status: 409 },
          );
        }
        const actorError = await requireMutationActor(req, payload.actorLogin);
        if (actorError) return actorError;
        const entry = await writeGuidanceFile(kind, {
          slug,
          body: payload.body,
          agent: payload.agent,
        });
        return NextResponse.json({ entry });
      } catch (error) {
        return failure(kind, "Create", error);
      } finally {
        clearGitHubContext();
      }
    },
  };
}

export function createGuidanceDetailHandlers(kind: GuidanceKind) {
  return {
    async GET(
      req: NextRequest,
      context: { params: Promise<{ slug: string }> },
    ) {
      const auth = await verifyRepoReadAccess(req);
      if (auth instanceof NextResponse) return auth;
      setRequestContext(req);
      try {
        const { slug } = await context.params;
        if (!isValidGuidanceSlug(slug)) {
          return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
        }
        const entry = await readGuidanceFile(kind, slug);
        return entry
          ? NextResponse.json({ entry }, { headers: NO_STORE_HEADERS })
          : NextResponse.json({ error: "not_found" }, { status: 404 });
      } catch (error) {
        return failure(kind, "Fetch", error);
      } finally {
        clearGitHubContext();
      }
    },
    async PATCH(
      req: NextRequest,
      context: { params: Promise<{ slug: string }> },
    ) {
      const auth = await verifyRepoWriteAccess(req);
      if (auth instanceof NextResponse) return auth;
      setRequestContext(req);
      try {
        const { slug } = await context.params;
        if (!isValidGuidanceSlug(slug)) {
          return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
        }
        const payload = updateSchema.parse(await req.json());
        const existing = await readGuidanceFile(kind, slug);
        if (!existing)
          return NextResponse.json({ error: "not_found" }, { status: 404 });
        const actorError = await requireMutationActor(req, payload.actorLogin);
        if (actorError) return actorError;
        const entry = await writeGuidanceFile(kind, {
          slug,
          body: payload.body ?? existing.body,
          agent: payload.agent ?? existing.agent,
        });
        return NextResponse.json({ entry });
      } catch (error) {
        return failure(kind, "Update", error);
      } finally {
        clearGitHubContext();
      }
    },
    async DELETE(
      req: NextRequest,
      context: { params: Promise<{ slug: string }> },
    ) {
      const auth = await verifyRepoWriteAccess(req);
      if (auth instanceof NextResponse) return auth;
      setRequestContext(req);
      try {
        const { slug } = await context.params;
        if (!isValidGuidanceSlug(slug)) {
          return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
        }
        if (!(await readGuidanceFile(kind, slug))) {
          return NextResponse.json({ error: "not_found" }, { status: 404 });
        }
        const actorLogin =
          new URL(req.url).searchParams.get("actorLogin") ?? undefined;
        const actorError = await requireMutationActor(req, actorLogin);
        if (actorError) return actorError;
        await deleteGuidanceFile(kind, slug);
        return NextResponse.json({ success: true });
      } catch (error) {
        return failure(kind, "Delete", error);
      } finally {
        clearGitHubContext();
      }
    },
  };
}
