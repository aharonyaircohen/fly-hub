import path from "node:path";

import {
  CmsConfigError,
  applyInMemoryFilters,
  applyInMemorySort,
  assertOperationAllowed,
  getCollection,
  getCollectionIdField,
  validateDocument,
} from "../../contract/index.mjs";

export const adapterName = "github";
export const createCmsAdapter = createGithubCmsAdapter;

export function createGithubCmsAdapter(options) {
  const { config, approved = false } = options;
  let transportPromise;

  async function transport() {
    if (options.transport) return options.transport;
    transportPromise ??= resolveGitHubTarget(options).then(
      createGitHubContentsTransport,
    );
    return transportPromise;
  }

  return {
    async list(collectionName, query = {}) {
      assertOperationAllowed(config, collectionName, "list");
      const collection = getCollection(config, collectionName);
      return listGitHubDocuments(await transport(), collection, query);
    },

    async listByIds(collectionName, ids = []) {
      assertOperationAllowed(config, collectionName, "list");
      const collection = getCollection(config, collectionName);
      const docs = [];
      const content = await transport();
      for (const id of ids) {
        const doc = await readDoc(content, collection, id).catch((error) => {
          if (isMissing(error)) return null;
          throw error;
        });
        if (doc) docs.push(doc);
      }
      return docs;
    },

    async search(collectionName, query = {}) {
      assertOperationAllowed(config, collectionName, "search");
      const collection = getCollection(config, collectionName);
      return listGitHubDocuments(await transport(), collection, query);
    },

    async get(collectionName, id) {
      assertOperationAllowed(config, collectionName, "get");
      const collection = getCollection(config, collectionName);
      return readDoc(await transport(), collection, id).catch((error) => {
        if (isMissing(error)) return null;
        throw error;
      });
    },

    async create(collectionName, data, operationOptions = {}) {
      assertOperationAllowed(config, collectionName, "create", {
        approved: operationOptions.approved ?? approved,
      });
      const collection = getCollection(config, collectionName);
      const validation = validateDocument(collection, data);
      if (!validation.ok) throw new CmsConfigError(validation.errors);

      const id = getDocumentId(collection, validation.value, collectionName);
      const content = await transport();
      const filePath = docPath(collection, id);
      const existing = await readDoc(content, collection, id).catch((error) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (existing)
        throw new CmsConfigError([`${collectionName}/${id} already exists`]);

      await content.writeFile(
        filePath,
        `${JSON.stringify(validation.value, null, 2)}\n`,
        {
          message: `cms: create ${collectionName}/${id}`,
        },
      );
      return readDoc(content, collection, id);
    },

    async update(collectionName, id, data, operationOptions = {}) {
      assertOperationAllowed(config, collectionName, "update", {
        approved: operationOptions.approved ?? approved,
      });
      const collection = getCollection(config, collectionName);
      const content = await transport();
      const current = await readDoc(content, collection, id).catch((error) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (!current) return null;

      const idField = getCollectionIdField(collection);
      if (
        data?.[idField] !== undefined &&
        String(data[idField]) !== String(id)
      ) {
        throw new CmsConfigError([
          `${collectionName} update cannot change ${idField}`,
        ]);
      }

      const next = { ...current, ...data };
      const validation = validateDocument(collection, next);
      if (!validation.ok) throw new CmsConfigError(validation.errors);
      await content.writeFile(
        docPath(collection, id),
        `${JSON.stringify(validation.value, null, 2)}\n`,
        {
          message: `cms: update ${collectionName}/${id}`,
        },
      );
      return readDoc(content, collection, id);
    },

    async delete(collectionName, id, operationOptions = {}) {
      assertOperationAllowed(config, collectionName, "delete", {
        approved: operationOptions.approved ?? approved,
      });
      const collection = getCollection(config, collectionName);
      const content = await transport();
      try {
        await content.deleteFile(docPath(collection, id), {
          message: `cms: delete ${collectionName}/${id}`,
        });
        return { deleted: true };
      } catch (error) {
        if (isMissing(error)) return { deleted: false };
        throw error;
      }
    },
  };
}

export function createGitHubContentsTransport({
  octokit,
  owner,
  repo,
  branch,
  basePath = "",
}) {
  const rootPath = safeRootPath(basePath);

  return {
    async listFiles(dirPath) {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: withBasePath(rootPath, dirPath),
        ref: branch,
      });
      return Array.isArray(data)
        ? data
            .filter(
              (item) => item.type === "file" && typeof item.path === "string",
            )
            .map((item) => stripBasePath(rootPath, item.path))
        : [];
    },

    async readFile(filePath) {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: withBasePath(rootPath, filePath),
        ref: branch,
      });
      if (Array.isArray(data) || !data.content) {
        throw Object.assign(new Error("not a file"), { status: 404 });
      }
      return Buffer.from(data.content, "base64").toString("utf8");
    },

    async writeFile(filePath, content, { message }) {
      const targetPath = withBasePath(rootPath, filePath);
      let sha;
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path: targetPath,
          ref: branch,
        });
        if (!Array.isArray(data)) sha = data.sha;
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: targetPath,
        branch,
        message,
        sha,
        content: Buffer.from(content).toString("base64"),
      });
    },

    async deleteFile(filePath, { message }) {
      const targetPath = withBasePath(rootPath, filePath);
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: targetPath,
        ref: branch,
      });
      if (Array.isArray(data)) {
        throw Object.assign(new Error("not a file"), { status: 400 });
      }
      await octokit.repos.deleteFile({
        owner,
        repo,
        path: targetPath,
        branch,
        message,
        sha: data.sha,
      });
    },
  };
}

async function resolveGitHubTarget(options) {
  const explicit =
    options.github ??
    options.stateRepository ??
    options.repository ??
    null;
  const octokit = options.octokit ?? explicit?.octokit;
  const owner = stringValue(options.owner) ?? stringValue(explicit?.owner);
  const repo = stringValue(options.repo) ?? stringValue(explicit?.repo);
  const branch =
    stringValue(options.branch) ??
    stringValue(options.ref) ??
    stringValue(explicit?.branch) ??
    stringValue(explicit?.ref) ??
    "main";
  const basePath =
    stringValue(options.basePath) ?? stringValue(explicit?.basePath) ?? "";

  if (!octokit || !owner || !repo) {
    throw new CmsConfigError([
      "GitHub adapter requires octokit, owner, and repo",
    ]);
  }
  return { octokit, owner, repo, branch, basePath };
}

async function listGitHubDocuments(transport, collection, query = {}) {
  const docs = await readCollectionDocs(transport, collection);
  const filtered = applyInMemoryFilters(docs, collection, query.filters ?? {});
  const searched = applySearch(filtered, collection, query.search);
  const sorted = applyInMemorySort(
    searched,
    query.sort ?? collection.defaultSort,
  );
  const offset = Math.max(0, Number(query.offset ?? 0));
  const limit = clampLimit(query.limit);
  return {
    docs: sorted.slice(offset, offset + limit),
    total: sorted.length,
    limit,
    offset,
  };
}

async function readCollectionDocs(transport, collection) {
  const rootPath = collectionPath(collection);
  const files = await transport.listFiles(rootPath).catch((error) => {
    if (isMissing(error)) return [];
    throw error;
  });
  const extension = getExtension(collection);
  const docs = [];
  for (const filePath of files.filter((file) =>
    file.endsWith(`.${extension}`),
  )) {
    docs.push(JSON.parse(await transport.readFile(filePath)));
  }
  return docs;
}

async function readDoc(transport, collection, id) {
  return JSON.parse(await transport.readFile(docPath(collection, id)));
}

function applySearch(docs, collection, search) {
  const query = search?.query?.trim();
  if (!query) return docs;
  const fields = search?.fields?.length
    ? search.fields
    : collection.searchFields?.length
      ? collection.searchFields
      : [collection.titleField].filter(Boolean);
  if (fields.length === 0) return docs;
  const needle = query.toLowerCase();
  return docs.filter((doc) =>
    fields.some((field) =>
      String(doc[field] ?? "")
        .toLowerCase()
        .includes(needle),
    ),
  );
}

function getDocumentId(collection, data, collectionName) {
  const idField = getCollectionIdField(collection);
  const id = data?.[idField] ?? data?.id;
  if (id === undefined || id === null || String(id).trim() === "") {
    throw new CmsConfigError([`${collectionName} create requires an id`]);
  }
  return String(id);
}

function docPath(collection, id) {
  return safeJoin(
    collectionPath(collection),
    `${safeDocumentId(id)}.${getExtension(collection)}`,
  );
}

function collectionPath(collection) {
  return (
    stringValue(collection.source?.path) ??
    stringValue(collection.source?.collection) ??
    collection.name
  );
}

function getExtension(collection) {
  const extension = stringValue(collection.source?.extension) ?? "json";
  if (!/^[A-Za-z0-9]+$/.test(extension)) {
    throw new CmsConfigError([`unsafe file extension: ${extension}`]);
  }
  if (extension !== "json") {
    throw new CmsConfigError(["GitHub adapter only supports json documents"]);
  }
  return extension;
}

function withBasePath(basePath, filePath) {
  return safeJoin(basePath, filePath);
}

function stripBasePath(basePath, filePath) {
  const normalizedBase = safeRootPath(basePath);
  const normalizedFile = safeRootPath(filePath);
  if (!normalizedBase) return normalizedFile;
  return normalizedFile.startsWith(`${normalizedBase}/`)
    ? normalizedFile.slice(normalizedBase.length + 1)
    : normalizedFile;
}

function safeJoin(...segments) {
  const joined = segments.filter(Boolean).join("/");
  const normalized = path.posix.normalize(joined).replace(/^\/+|\/+$/g, "");
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new CmsConfigError(["resolved GitHub path escapes root"]);
  }
  return normalized;
}

function safeRootPath(value) {
  if (!value) return "";
  return safeJoin(value);
}

function safeDocumentId(id) {
  const value = String(id);
  if (
    value.trim() === "" ||
    value.includes("\0") ||
    value.includes("/") ||
    value.includes("\\") ||
    value === "." ||
    value === ".."
  ) {
    throw new CmsConfigError([`unsafe document id: ${value}`]);
  }
  return value;
}

function clampLimit(limit) {
  const numeric = Number(limit ?? 50);
  if (!Number.isFinite(numeric)) return 50;
  return Math.max(1, Math.min(100, numeric));
}

function isMissing(error) {
  return error?.status === 404 || error?.code === "ENOENT";
}

function stringValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
