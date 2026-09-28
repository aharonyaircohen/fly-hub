/** Repository-owned chat models shared by every authenticated repository user. */
import { NextRequest, NextResponse } from "next/server";
import {
  AutomaticModelSchema,
  ChatModelsSchema,
} from "@kody-ade/base/variables/models";
import { ModelsWriteSchema } from "@kody-ade/base/variables/mutations";
import {
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
} from "@kody-ade/base/auth";
import { logger } from "@kody-ade/base/logger";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "@dashboard/lib/backend/convex-backend";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NAMESPACE = "chat-models";
const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function parseSettings(value: unknown) {
  const stored =
    value && typeof value === "object"
      ? (value as { models?: unknown; automatic?: unknown })
      : {};
  const models = ChatModelsSchema.safeParse(stored.models);
  const automatic = AutomaticModelSchema.safeParse(stored.automatic);
  return {
    models: models.success ? models.data : [],
    automatic: automatic.success
      ? { ...automatic.data, engineDefault: false }
      : AutomaticModelSchema.parse({}),
  };
}

async function repositoryContext(
  req: NextRequest,
): Promise<
  { auth: { owner: string; repo: string } } | { error: NextResponse }
> {
  const access =
    req.method === "GET"
      ? await verifyRepoReadAccess(req)
      : await verifyRepoWriteAccess(req);
  if (access instanceof NextResponse) return { error: access };
  return { auth: access.auth };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const context = await repositoryContext(req);
  if ("error" in context) return context.error;
  const tenantId = tenantIdFor(context.auth.owner, context.auth.repo);
  try {
    const stored = await getConvexClient().query(
      backendApi.repositoryPreferences.get,
      {
        tenantId,
        namespace: NAMESPACE,
      },
    );
    return NextResponse.json(parseSettings(stored?.data), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    logger.error({ error, tenantId }, "repository models: list failed");
    return NextResponse.json(
      { error: "repository_models_read_failed" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const context = await repositoryContext(req);
  if ("error" in context) return context.error;
  const parsed = ModelsWriteSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_error", details: parsed.error.format() },
      { status: 400 },
    );
  }
  const tenantId = tenantIdFor(context.auth.owner, context.auth.repo);
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
    await getConvexClient().mutation(backendApi.repositoryPreferences.save, {
      tenantId,
      namespace: NAMESPACE,
      data,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true, ...data });
  } catch (error) {
    logger.error({ error, tenantId }, "repository models: write failed");
    return NextResponse.json(
      { error: "repository_models_write_failed" },
      { status: 500 },
    );
  }
}
