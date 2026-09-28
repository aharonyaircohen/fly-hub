import "server-only";

import { NextResponse } from "next/server";
import {
  AutomaticModelSchema,
  ChatModelsSchema,
  scopedChatModelId,
} from "@kody-ade/base/variables/models";
import { decrypt } from "@kody-ade/base/vault/crypto";
import { setChatModelSettingsProvider } from "@kody-ade/kody-chat-dashboard/chat/model-settings-provider";
import { setChatRequestContextProvider } from "@kody-ade/kody-chat-dashboard/chat/request-context-provider";
import { isBuiltInChatModelId } from "@kody-ade/kody-chat-dashboard/chat/model-catalog";
import {
  backendApi,
  getConvexClient,
  tenantIdFor,
} from "@dashboard/lib/backend/convex-backend";
import { requireKodyUser } from "@dashboard/lib/auth/kody-user";
import { getRequestAuth, getUserOctokit } from "@kody-ade/base/auth";
import type { NextRequest } from "next/server";
import {
  ACCOUNT_REPOSITORY_CREDENTIAL_NAME,
  parseAccountRepositoryCredentials,
} from "@dashboard/lib/auth/account-repository-connections";

const MODELS_NAMESPACE = "chat-models";

async function authenticatedUserId(): Promise<string | null> {
  const actor = await requireKodyUser();
  return actor instanceof NextResponse ? null : actor.id;
}

export async function readPersonalCredential(
  name: string,
): Promise<string | null> {
  const userKey = await authenticatedUserId();
  if (!userKey) return null;
  const stored = await getConvexClient().query(backendApi.userCredentials.get, {
    userKey,
    name,
  });
  return stored?.encryptedValue ? decrypt(stored.encryptedValue) : null;
}

export async function readPersonalModelSettings(): Promise<{
  models: ReturnType<typeof ChatModelsSchema.parse>;
  automatic: ReturnType<typeof AutomaticModelSchema.parse>;
} | null> {
  const userKey = await authenticatedUserId();
  if (!userKey) return null;
  const stored = await getConvexClient().query(backendApi.userPreferences.get, {
    namespace: MODELS_NAMESPACE,
    userKey,
  });
  const data = stored?.data as
    { models?: unknown; automatic?: unknown } | undefined;
  const models = ChatModelsSchema.safeParse(data?.models);
  const automatic = AutomaticModelSchema.safeParse(data?.automatic);
  return {
    models: models.success ? models.data : [],
    automatic: automatic.success
      ? { ...automatic.data, engineDefault: false }
      : AutomaticModelSchema.parse({}),
  };
}

async function readRepositoryModelSettings(req: NextRequest) {
  const auth = getRequestAuth(req);
  if (!auth) return null;
  const octokit = await getUserOctokit(req);
  if (!octokit) return null;
  try {
    await octokit.rest.repos.get({ owner: auth.owner, repo: auth.repo });
  } catch {
    return null;
  }
  const stored = await getConvexClient().query(
    backendApi.repositoryPreferences.get,
    {
      tenantId: tenantIdFor(auth.owner, auth.repo),
      namespace: MODELS_NAMESPACE,
    },
  );
  const data = stored?.data as
    { models?: unknown; automatic?: unknown } | undefined;
  const models = ChatModelsSchema.safeParse(data?.models);
  const automatic = AutomaticModelSchema.safeParse(data?.automatic);
  return {
    models: models.success ? models.data : [],
    automatic: automatic.success
      ? { ...automatic.data, engineDefault: false }
      : AutomaticModelSchema.parse({}),
  };
}

export function mergeChatModelSettings(
  personal: NonNullable<Awaited<ReturnType<typeof readPersonalModelSettings>>>,
  repository: NonNullable<
    Awaited<ReturnType<typeof readRepositoryModelSettings>>
  >,
) {
  const repositoryHasDefault =
    repository.automatic.default === true ||
    repository.models.some((model) => model.default === true);
  return {
    models: [
      ...repository.models.map((model) => ({
        ...model,
        id: scopedChatModelId("repo", model.id),
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
              }
            : { ...model, id: scopedChatModelId("personal", model.id) },
      ),
    ],
    automatic:
      repository.automatic.default === true
        ? repository.automatic
        : personal.automatic,
  };
}

setChatRequestContextProvider({
  async resolveUser() {
    const actor = await requireKodyUser();
    if (actor instanceof NextResponse) return null;
    return { id: actor.id, label: actor.label };
  },
  async resolveRepositories() {
    const stored = await readPersonalCredential(
      ACCOUNT_REPOSITORY_CREDENTIAL_NAME,
    );
    if (!stored) return [];
    try {
      return parseAccountRepositoryCredentials(JSON.parse(stored));
    } catch {
      return [];
    }
  },
});

setChatModelSettingsProvider({
  async load(req) {
    const personal = await readPersonalModelSettings();
    if (!personal) return null;
    const repository = await readRepositoryModelSettings(req);
    return repository ? mergeChatModelSettings(personal, repository) : personal;
  },

  async getCredential(_request, name) {
    return (await readPersonalCredential(name)) ?? process.env[name] ?? null;
  },
});
