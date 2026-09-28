import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import type { CmsStorageTransport } from "./storage-transport";

export type CmsFilesDoc = { files: Record<string, string> };
export type CmsWriteFile = { path: string; content: string };

export interface CmsRepoDocsRecord {
  doc: CmsFilesDoc;
  updatedAt: string;
}

export interface CmsRepoDocsStore {
  load(owner: string, repo: string): Promise<CmsRepoDocsRecord | null>;
  save(
    owner: string,
    repo: string,
    doc: CmsFilesDoc,
    expectedUpdatedAt?: string,
  ): Promise<string>;
}

const requestStore = new AsyncLocalStorage<CmsRepoDocsStore>();

export function runWithCmsRepoDocsStore<T>(
  store: CmsRepoDocsStore,
  callback: () => T,
): T {
  return requestStore.run(store, callback);
}

function cmsRepoDocsStore(): CmsRepoDocsStore {
  const store = requestStore.getStore();
  if (!store) {
    throw new Error(
      "CMS repository storage was not provided for this request.",
    );
  }
  return store;
}

async function load(
  owner: string,
  repo: string,
): Promise<CmsRepoDocsRecord | null> {
  return await cmsRepoDocsStore().load(owner, repo);
}

export async function readCmsFile(
  owner: string,
  repo: string,
  path: string,
): Promise<{ content: string; updatedAt: string; sha: string } | null> {
  const record = await load(owner, repo);
  if (!record) return null;
  const content = record?.doc.files[path];
  return typeof content === "string"
    ? { content, updatedAt: record.updatedAt, sha: record.updatedAt }
    : null;
}

export async function writeCmsFiles(
  owner: string,
  repo: string,
  files: Array<{ path: string; content: string }>,
  expectedUpdatedAt?: string,
): Promise<string> {
  const current = await load(owner, repo);
  const next = { ...(current?.doc.files ?? {}) };
  for (const file of files) next[file.path] = file.content;
  return await cmsRepoDocsStore().save(
    owner,
    repo,
    { files: next },
    expectedUpdatedAt,
  );
}

export async function deleteCmsFile(
  owner: string,
  repo: string,
  path: string,
  expectedUpdatedAt?: string,
): Promise<string> {
  const current = await load(owner, repo);
  if (!current?.doc.files[path])
    return current?.updatedAt ?? new Date().toISOString();
  const next = { ...current.doc.files };
  delete next[path];
  return await cmsRepoDocsStore().save(
    owner,
    repo,
    { files: next },
    expectedUpdatedAt,
  );
}

export function createCmsRepoDocsTransport(
  owner: string,
  repo: string,
): CmsStorageTransport {
  const store = cmsRepoDocsStore();
  const withinStore = <T>(callback: () => T): T =>
    runWithCmsRepoDocsStore(store, callback);

  return {
    async listFiles(dirPath) {
      const record = await withinStore(() => load(owner, repo));
      const prefix = dirPath ? `${dirPath.replace(/\/+$/, "")}/` : "";
      return Object.keys(record?.doc.files ?? {}).filter((path) =>
        path.startsWith(prefix),
      );
    },
    async readFile(path) {
      const file = await withinStore(() => readCmsFile(owner, repo, path));
      if (!file) {
        throw Object.assign(new Error("not a file"), { status: 404 });
      }
      return file.content;
    },
    async writeFile(path, content) {
      const current = await withinStore(() => load(owner, repo));
      await withinStore(() =>
        writeCmsFiles(owner, repo, [{ path, content }], current?.updatedAt),
      );
    },
    async deleteFile(path) {
      const current = await withinStore(() => load(owner, repo));
      if (!current?.doc.files[path]) {
        throw Object.assign(new Error("not a file"), { status: 404 });
      }
      await withinStore(() =>
        deleteCmsFile(owner, repo, path, current.updatedAt),
      );
    },
  };
}

export async function readRepoDocFile(
  _octokit: unknown,
  owner: string,
  repo: string,
  path: string,
) {
  return await readCmsFile(owner, repo, path);
}
export async function writeRepoDocFiles(args: {
  octokit?: unknown;
  owner: string;
  repo: string;
  files: CmsWriteFile[];
  message?: string;
}) {
  return await writeCmsFiles(args.owner, args.repo, args.files);
}
export async function writeRepoDocFile(args: {
  octokit?: unknown;
  owner: string;
  repo: string;
  path: string;
  content: string;
  message?: string;
}) {
  return await writeCmsFiles(args.owner, args.repo, [
    { path: args.path, content: args.content },
  ]);
}
export async function deleteRepoDocFile(args: {
  octokit?: unknown;
  owner: string;
  repo: string;
  path: string;
  sha?: string;
  message?: string;
}) {
  return await deleteCmsFile(args.owner, args.repo, args.path, args.sha);
}
