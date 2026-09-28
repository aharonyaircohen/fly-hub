/** User-owned chat model settings. Repository Engine models are configured separately. */
import { NextRequest, NextResponse } from "next/server";
import {
  AutomaticModelSchema,
  ChatModelsSchema,
  scopedChatModelId,
} from "@kody-ade/base/variables/models";
import { ModelsWriteSchema } from "@kody-ade/base/variables/mutations";
import { logger } from "@kody-ade/base/logger";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import { getRequestAuth, getUserOctokit } from "@kody-ade/base/auth";
import { isBuiltInChatModelId } from "@kody-ade/kody-chat-dashboard/chat/model-catalog";
import { loadOpenCodeFreeModels } from "@kody-ade/kody-chat-dashboard/chat/opencode-free";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "@dashboard/lib/backend/convex-backend";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const NAMESPACE = "chat-models";

function parseStoredSettings(value: unknown) {
  if (!value || typeof value !== "object") {
    return { models: [], automatic: AutomaticModelSchema.parse({}) };
  }
  const stored = value as { models?: unknown; automatic?: unknown };
  const models = ChatModelsSchema.safeParse(stored.models);
  const automatic = AutomaticModelSchema.safeParse(stored.automatic);
  return {
    models: models.success ? models.data : [],
    automatic: automatic.success
      ? { ...automatic.data, engineDefault: false }
      : AutomaticModelSchema.parse({}),
  };
}

export async function GET(req?: NextRequest) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;

  if (req?.nextUrl.searchParams.get("catalog") === "opencode-free") {
    try {
      return NextResponse.json(
        { models: await loadOpenCodeFreeModels() },
        { headers: NO_STORE_HEADERS },
      );
    } catch {
      return NextResponse.json(
        {
          error: "OpenCode's free model list is unavailable. Try again later.",
        },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
  }

  try {
    const stored = await getConvexClient().query(
      backendApi.userPreferences.get,
      {
        namespace: NAMESPACE,
        userKey: actor.id,
      },
    );
    const personal = parseStoredSettings(stored?.data);
    const auth = req ? getRequestAuth(req) : null;
    if (!req || !auth || req.nextUrl.searchParams.get("scope") === "personal") {
      return NextResponse.json(personal, { headers: NO_STORE_HEADERS });
    }
    const octokit = await getUserOctokit(req);
    if (!octokit) {
      return NextResponse.json(personal, { headers: NO_STORE_HEADERS });
    }
    try {
      await octokit.rest.repos.get({ owner: auth.owner, repo: auth.repo });
    } catch {
      return NextResponse.json(personal, { headers: NO_STORE_HEADERS });
    }
    const repositoryStored = await getConvexClient().query(
      backendApi.repositoryPreferences.get,
      {
        tenantId: tenantIdFor(auth.owner, auth.repo),
        namespace: NAMESPACE,
      },
    );
    const repository = parseStoredSettings(repositoryStored?.data);
    const repositoryHasDefault =
      repository.automatic.default === true ||
      repository.models.some((model) => model.default === true);
    return NextResponse.json(
      {
        models: [
          ...repository.models.map((model) => ({
            ...model,
            id: scopedChatModelId("repo", model.id),
            scope: "repo",
          })),
          ...personal.models.map((model) =>
            isBuiltInChatModelId(model.id)
              ? repositoryHasDefault
                ? { ...model, default: false }
                : model
              : repositoryHasDefault
                ? {
                    ...model,
                    id: scopedChatModelId("personal", model.id),
                    default: false,
                    scope: "personal",
                  }
                : {
                    ...model,
                    id: scopedChatModelId("personal", model.id),
                    scope: "personal",
                  },
          ),
        ],
        automatic: repository.automatic.default
          ? repository.automatic
          : personal.automatic,
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch (error) {
    logger.error({ error, userId: actor.id }, "personal models: list failed");
    return NextResponse.json(
      { error: "models_read_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}

export async function PUT(req: NextRequest) {
  const actor = await requireKodyUser();
  if (actor instanceof NextResponse) return actor;

  const raw = await req.json().catch(() => null);
  const userOnlyInput =
    raw && typeof raw === "object"
      ? {
          ...(raw as Record<string, unknown>),
          models: Array.isArray((raw as { models?: unknown }).models)
            ? ((raw as { models: unknown[] }).models.map((model) =>
                model && typeof model === "object"
                  ? {
                      ...(model as Record<string, unknown>),
                      engineDefault: false,
                    }
                  : model,
              ) as unknown[])
            : (raw as { models?: unknown }).models,
          automatic:
            (raw as { automatic?: unknown }).automatic &&
            typeof (raw as { automatic?: unknown }).automatic === "object"
              ? {
                  ...(raw as { automatic: Record<string, unknown> }).automatic,
                  engineDefault: false,
                }
              : (raw as { automatic?: unknown }).automatic,
        }
      : raw;
  const parsed = ModelsWriteSchema.safeParse(userOnlyInput);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }

  const data = {
    models: parsed.data.models.map((model) => ({
      ...model,
      engineDefault: false,
    })),
    automatic: {
      ...(parsed.data.automatic ?? AutomaticModelSchema.parse({})),
      engineDefault: false,
    },
  };

  try {
    await getConvexClient().mutation(backendApi.userPreferences.save, {
      namespace: NAMESPACE,
      userKey: actor.id,
      data,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    logger.error({ error, userId: actor.id }, "personal models: write failed");
    return NextResponse.json({ error: "models_write_failed" }, { status: 500 });
  }
}
