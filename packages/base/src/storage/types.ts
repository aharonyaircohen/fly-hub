export interface StorageFile {
  path: string;
  content: string;
  version: string;
  etag?: string;
  url?: string;
  size?: number;
}

export interface StorageFileMetadata {
  path: string;
  version: string;
  url?: string;
  size?: number;
}

export interface StorageEntry {
  name: string;
  path: string;
  type: string;
  size?: number;
  url?: string;
}

export interface StorageListResult {
  path: string;
  entries: StorageEntry[];
  etag?: string;
}

export interface StorageWriteResult {
  path: string;
  version: string | null;
  url: string | null;
}

export interface StorageCommitResult {
  version: string;
}

export interface StorageTextFile {
  path: string;
  content: string;
}

export interface StorageBase64File {
  path: string;
  contentBase64: string;
}

export interface StorageReadOptions {
  headers?: Record<string, string>;
}

export interface StorageWriteTextOptions<TTarget> {
  target: TTarget;
  path: string;
  content: string;
  message: string;
  version?: string;
  maxAttempts?: number;
}

export interface StorageWriteBase64Options<TTarget> {
  target: TTarget;
  path: string;
  contentBase64: string;
  message: string;
  version?: string;
  maxAttempts?: number;
}

export interface StorageWriteTextFilesOptions<TTarget> {
  target: TTarget;
  files: StorageTextFile[];
  message: string;
}

export interface StorageWriteBase64FilesOptions<TTarget> {
  target: TTarget;
  files: StorageBase64File[];
  message: string;
}

export interface StorageDeleteFileOptions<TTarget> {
  target: TTarget;
  path: string;
  version: string;
  message: string;
}

export interface StorageDeleteDirectoryOptions<TTarget> {
  target: TTarget;
  path: string;
  message: string;
}

export interface StorageAdapter<TTarget = unknown> {
  readonly name: string;
  readText(
    target: TTarget,
    path: string,
    options?: StorageReadOptions,
  ): Promise<StorageFile | null>;
  readMetadata(
    target: TTarget,
    path: string,
  ): Promise<StorageFileMetadata | null>;
  list(
    target: TTarget,
    path: string,
    options?: StorageReadOptions,
  ): Promise<StorageListResult>;
  writeText(
    options: StorageWriteTextOptions<TTarget>,
  ): Promise<StorageWriteResult>;
  writeBase64(
    options: StorageWriteBase64Options<TTarget>,
  ): Promise<StorageWriteResult>;
  writeTextFiles(
    options: StorageWriteTextFilesOptions<TTarget>,
  ): Promise<StorageCommitResult>;
  writeBase64Files(
    options: StorageWriteBase64FilesOptions<TTarget>,
  ): Promise<StorageCommitResult>;
  deleteFile(options: StorageDeleteFileOptions<TTarget>): Promise<void>;
  deleteDirectory(
    options: StorageDeleteDirectoryOptions<TTarget>,
  ): Promise<{ deleted: number }>;
}
