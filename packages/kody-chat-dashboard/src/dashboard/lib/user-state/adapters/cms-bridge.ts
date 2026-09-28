/**
 * @fileType utility
 * @domain user-state
 * @pattern user-state-adapter
 * @ai-summary CMS bridge user-state adapter: routes a namespace's per-user
 *   documents into a brand CMS collection (e.g. MongoDB) declared as
 *   `adapter: "cms:<collection>"`. Ownership scoping is enforced with a
 *   reserved `_kodyUserId` field — always filtered on read and stamped on
 *   write, so a user can only ever reach their own document. The CMS
 *   collection and its backend stay entirely brand-owned.
 */
import "server-only";
import type { Octokit } from "@octokit/rest";
import { getCmsAdapter } from "@kody-ade/cms/adapters";
import type {
  CmsAdapter,
  CmsAdapterContext,
} from "@kody-ade/cms/adapters/types";
import { defaultCmsAdapterSettings } from "@kody-ade/cms/adapter-catalog";
import { loadCmsConfigFromState } from "@kody-ade/cms/config";
import {
  createCmsRepoDocsTransport,
  runWithCmsRepoDocsStore,
} from "@kody-ade/cms/repo-docs";
import type { CmsCollectionConfig, CmsDocument } from "@kody-ade/cms/types";
import { logger } from "@kody-ade/base/logger";
import { readVault } from "@kody-ade/base/vault/store";
import { isVaultConfigured } from "@kody-ade/base/vault/crypto";
import {
  UserStateError,
  type UserStateAdapter,
  type UserStateAdapterContext,
  type UserStateDoc,
  type UserStateNamespace,
} from "../types";
import { createBackendCmsRepoDocsStore } from "../../backend/cms-repo-docs-store";

export const CMS_BRIDGE_ADAPTER_PREFIX = "cms:";

/** Reserved ownership field stamped on every bridged document. */
export const KODY_USER_ID_FIELD = "_kodyUserId";

export function parseCmsBridgeCollection(adapterName: string): string | null {
  if (!adapterName.startsWith(CMS_BRIDGE_ADAPTER_PREFIX)) return null;
  const collection = adapterName.slice(CMS_BRIDGE_ADAPTER_PREFIX.length).trim();
  return collection.length > 0 ? collection : null;
}

/**
 * Vault-first secret resolver that works without a NextRequest — trigger
 * writes run outside a user request scope.
 */
async function resolveSecret(
  octokit: Octokit,
  owner: string,
  repo: string,
  name: string,
): Promise<string | null> {
  if (isVaultConfigured()) {
    try {
      const { doc } = await readVault(octokit, owner, repo);
      const entry = doc.secrets[name];
      if (entry?.value) return entry.value;
    } catch (err) {
      logger.warn(
        { err, name, owner, repo },
        "cms-bridge: vault read failed; falling back to env",
      );
    }
  }
  return process.env[name] ?? null;
}

async function resolveCmsBinding(
  ctx: UserStateAdapterContext,
  collectionName: string,
): Promise<{
  adapter: CmsAdapter;
  context: CmsAdapterContext;
  collection: CmsCollectionConfig;
}> {
  return runWithCmsRepoDocsStore(createBackendCmsRepoDocsStore(), async () => {
    const config = await loadCmsConfigFromState(
      ctx.octokit,
      ctx.owner,
      ctx.repo,
    );
    const collection = config?.collections[collectionName];
    if (!config || !collection) {
      throw new UserStateError(
        "config_invalid",
        `CMS collection "${collectionName}" is not configured for this repo`,
      );
    }
    const adapter = getCmsAdapter(collection.adapter);
    if (!adapter) {
      throw new UserStateError(
        "adapter_not_found",
        `CMS adapter "${collection.adapter}" is not available`,
      );
    }
    return {
      adapter,
      collection,
      context: {
        config,
        collection,
        settings: {
          ...defaultCmsAdapterSettings(collection.adapter),
          ...(config.adapters[collection.adapter] ?? {}),
        },
        getSecret: (name: string) =>
          resolveSecret(ctx.octokit, ctx.owner, ctx.repo, name),
        store: { octokit: ctx.octokit },
        transport: createCmsRepoDocsTransport(ctx.owner, ctx.repo),
      },
    };
  });
}

async function findOwnDocument(
  adapter: CmsAdapter,
  context: CmsAdapterContext,
  userId: string,
): Promise<CmsDocument | null> {
  const result = await adapter.list(context, {
    filters: { [KODY_USER_ID_FIELD]: { equals: userId } },
    limit: 1,
  });
  const doc = result.docs[0];
  // Defense-in-depth: brand/store-supplied adapters may mis-implement the
  // filter — never trust a returned document that isn't the user's own.
  if (!doc || doc[KODY_USER_ID_FIELD] !== userId) return null;
  return doc;
}

function documentId(
  collection: CmsCollectionConfig,
  doc: CmsDocument,
): string | null {
  const idField = collection.source?.idField ?? "_id";
  const value = doc[idField] ?? doc._id ?? doc.id;
  if (typeof value === "string" && value) return value;
  if (value != null && typeof value === "object") return String(value);
  return null;
}

function requireCollectionName(namespace: UserStateNamespace): string {
  const collectionName = parseCmsBridgeCollection(namespace.adapter);
  if (!collectionName) {
    throw new UserStateError(
      "adapter_not_found",
      `Invalid CMS bridge adapter "${namespace.adapter}"`,
    );
  }
  return collectionName;
}

export const cmsBridgeUserStateAdapter: UserStateAdapter = {
  name: "cms-bridge",

  async get(ctx, userId, namespace: UserStateNamespace) {
    const collectionName = requireCollectionName(namespace);
    const { adapter, context } = await resolveCmsBinding(ctx, collectionName);
    const doc = await findOwnDocument(adapter, context, userId);
    if (!doc) return null;

    const {
      [KODY_USER_ID_FIELD]: _owner,
      _kodyNamespaceVersion,
      _kodyUpdatedAt,
      _id,
      id: _plainId,
      ...data
    } = doc;
    return {
      version:
        typeof _kodyNamespaceVersion === "number"
          ? _kodyNamespaceVersion
          : namespace.version,
      namespace: namespace.name,
      userId,
      updatedAt: typeof _kodyUpdatedAt === "string" ? _kodyUpdatedAt : "",
      data,
    };
  },

  async set(ctx, userId, namespace: UserStateNamespace, doc: UserStateDoc) {
    const collectionName = requireCollectionName(namespace);
    const { adapter, context, collection } = await resolveCmsBinding(
      ctx,
      collectionName,
    );

    const payload: CmsDocument = {
      ...doc.data,
      [KODY_USER_ID_FIELD]: userId,
      _kodyNamespaceVersion: doc.version,
      _kodyUpdatedAt: doc.updatedAt,
    };

    const existing = await findOwnDocument(adapter, context, userId);
    if (!existing) {
      await adapter.create(context, payload);
      return;
    }
    const id = documentId(collection, existing);
    if (!id) {
      throw new UserStateError(
        "config_invalid",
        `CMS collection "${collectionName}" documents have no usable id field`,
      );
    }
    await adapter.update(context, id, payload);
  },
};
