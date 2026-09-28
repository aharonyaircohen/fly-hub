import "server-only";

import { api } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import {
  runWithCmsRepoDocsStore,
  type CmsFilesDoc,
  type CmsRepoDocsRecord,
  type CmsRepoDocsStore,
} from "@kody-ade/cms/repo-docs";

const CMS_FILES_KIND = "cms:files";

function tenantId(owner: string, repo: string): string {
  return `${owner}/${repo}`;
}

function normalizeRecord(record: unknown): CmsRepoDocsRecord | null {
  if (!record || typeof record !== "object") return null;
  const candidate = record as { doc?: unknown; updatedAt?: unknown };
  if (
    !candidate.doc ||
    typeof candidate.doc !== "object" ||
    typeof candidate.updatedAt !== "string"
  ) {
    return null;
  }
  const files = (candidate.doc as { files?: unknown }).files;
  return {
    doc: {
      files:
        files && typeof files === "object"
          ? (files as Record<string, string>)
          : {},
    },
    updatedAt: candidate.updatedAt,
  };
}

export function createBackendCmsRepoDocsStore(): CmsRepoDocsStore {
  return {
    async load(owner, repo) {
      const record = await createBackendClient().query(api.repoDocs.get, {
        tenantId: tenantId(owner, repo),
        kind: CMS_FILES_KIND,
      });
      return normalizeRecord(record);
    },

    async save(owner, repo, doc: CmsFilesDoc, expectedUpdatedAt) {
      const updatedAt = new Date().toISOString();
      await createBackendClient().mutation(api.repoDocs.save, {
        tenantId: tenantId(owner, repo),
        kind: CMS_FILES_KIND,
        doc,
        updatedAt,
        ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      });
      return updatedAt;
    },
  };
}

export function withDashboardCmsRepoDocsStore<T>(callback: () => T): T {
  return runWithCmsRepoDocsStore(createBackendCmsRepoDocsStore(), callback);
}
