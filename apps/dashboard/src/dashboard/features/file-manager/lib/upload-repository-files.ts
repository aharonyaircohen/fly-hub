import { joinRepoPath } from "./file-paths";
import {
  DEFAULT_FILE_UPLOAD_POLICY,
  type FileUploadPolicy,
  validateUpload,
} from "./file-upload-policy";

export interface UploadedRepositoryFile {
  file: File;
  path: string;
  sha: string;
}

export interface RejectedRepositoryFile {
  file: File;
  path: string;
  error: string;
}

export interface RepositoryUploadResult {
  uploaded: UploadedRepositoryFile[];
  rejected: RejectedRepositoryFile[];
}

interface UploadRepositoryFilesOptions {
  files: Iterable<File>;
  destinationDir: string;
  workspaceRoot?: string;
  policy?: FileUploadPolicy;
  upload: (
    path: string,
    file: File,
    message: string,
  ) => Promise<{ sha: string }>;
  onUploaded?: (uploaded: UploadedRepositoryFile) => void;
  onRejected?: (rejected: RejectedRepositoryFile) => void;
}

export async function uploadRepositoryFiles({
  files,
  destinationDir,
  workspaceRoot = "",
  policy = DEFAULT_FILE_UPLOAD_POLICY,
  upload,
  onUploaded,
  onRejected,
}: UploadRepositoryFilesOptions): Promise<RepositoryUploadResult> {
  const result: RepositoryUploadResult = { uploaded: [], rejected: [] };

  for (const file of files) {
    const relativePath = file.webkitRelativePath || file.name;
    const path = joinRepoPath(destinationDir, relativePath);
    const normalizedRoot = joinRepoPath("", workspaceRoot);
    const validationError =
      validateUpload(file, policy, relativePath) ??
      (normalizedRoot &&
      path !== normalizedRoot &&
      !path.startsWith(`${normalizedRoot}/`)
        ? "The upload path must stay inside this workspace."
        : null);

    if (validationError) {
      const rejected = { file, path, error: validationError };
      result.rejected.push(rejected);
      onRejected?.(rejected);
      continue;
    }

    try {
      const uploaded = await upload(path, file, `chore: upload ${path}`);
      const completed = { file, path, sha: uploaded.sha };
      result.uploaded.push(completed);
      onUploaded?.(completed);
    } catch (error) {
      const rejected = {
        file,
        path,
        error: error instanceof Error ? error.message : "Upload failed",
      };
      result.rejected.push(rejected);
      onRejected?.(rejected);
    }
  }

  return result;
}
