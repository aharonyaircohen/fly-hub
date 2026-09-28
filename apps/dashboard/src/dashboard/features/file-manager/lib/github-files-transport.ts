import type { Octokit } from "@octokit/rest";

import { githubFileUrl } from "./file-paths";
import {
  commitsForPath,
  getFileAtRef,
  listDir,
  readFile,
  searchCode,
  uploadFile,
  writeFile,
} from "./repo-files";
import {
  deleteRepositoryPath,
  duplicateRepositoryPath,
  moveRepositoryPath,
} from "./repo-file-operations";
import type { FilesTransport } from "./transport";

export function createGitHubFilesTransport(
  octokit: Octokit,
  owner: string,
  repo: string,
): FilesTransport {
  return {
    cacheKey: `github:${owner}/${repo}`,
    listDir: (path) => listDir(octokit, owner, repo, path),
    readFile: (path) => readFile(octokit, owner, repo, path),
    async writeFile(path, content, options) {
      const expectedVersion =
        options?.expectedVersion === undefined
          ? (await readFile(octokit, owner, repo, path))?.sha
          : (options.expectedVersion ?? undefined);
      const operation = expectedVersion ? "update" : "create";
      const result = await writeFile(
        octokit,
        owner,
        repo,
        path,
        content,
        `chore: ${operation} ${path}`,
        expectedVersion,
      );
      return { version: result.sha };
    },
    async deleteFile(path, type = "file") {
      await deleteRepositoryPath(octokit, owner, repo, path, type);
    },
    async createFolder(path) {
      const result = await writeFile(
        octokit,
        owner,
        repo,
        `${path}/.gitkeep`,
        "",
        `chore: create ${path}/`,
      );
      return { version: result.sha };
    },
    async uploadFile(path, file) {
      const result = await uploadFile(
        octokit,
        owner,
        repo,
        path,
        file,
        `chore: upload ${path}`,
      );
      return { version: result.sha };
    },
    async movePath({ sourcePath, sourceType, targetPath }) {
      await moveRepositoryPath(
        octokit,
        owner,
        repo,
        sourcePath,
        sourceType,
        targetPath,
      );
    },
    async duplicatePath({ sourcePath, sourceType, targetPath }) {
      await duplicateRepositoryPath(
        octokit,
        owner,
        repo,
        sourcePath,
        sourceType,
        targetPath,
      );
    },
    externalUrl: (path, type) => githubFileUrl(owner, repo, path, type),
    search: (query) => searchCode(octokit, owner, repo, query),
    history: (path, limit = 20) =>
      commitsForPath(octokit, owner, repo, path, limit),
    readVersion: (path, version) =>
      getFileAtRef(octokit, owner, repo, path, version),
  };
}
