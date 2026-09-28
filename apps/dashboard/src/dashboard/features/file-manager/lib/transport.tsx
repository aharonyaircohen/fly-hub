/**
 * @fileType util
 * @domain files
 * @pattern files-transport
 * @ai-summary Provider-neutral file workspace contract. Required read
 *   operations establish the workspace; optional methods advertise write,
 *   upload, delete, move, copy, and folder capabilities.
 */
"use client";

import { createContext, useContext } from "react";
import type {
  CommitInfo,
  FileContent,
  FileEntry,
  SearchResult,
} from "./repo-files";

export interface FilePathMutation {
  sourcePath: string;
  sourceType: FileEntry["type"];
  targetPath: string;
}

export interface FileWriteResult {
  version?: string;
}

export interface FileWriteOptions {
  /** null creates, a version updates, and undefined lets the provider resolve. */
  expectedVersion?: string | null;
}

export interface FileSearchResults {
  results: SearchResult[];
  total: number;
}

export interface FilesTransport {
  /**
   * Stable identity of the backing workspace. Changing it resets navigation
   * because the user has moved to a different workspace.
   */
  cacheKey?: string;
  /**
   * Version of the workspace data. Changing it refreshes listings and the
   * selected file without resetting navigation.
   */
  dataVersion?: string | number;
  /** List the entries of a directory path ("" = root). */
  listDir(path: string): Promise<FileEntry[]>;
  /** Read one file, or null when the path is not a file. */
  readFile(path: string): Promise<FileContent | null>;
  /**
   * Optional write: create or replace a file. When absent the workspace
   * is read-only and all write UI stays hidden.
   */
  writeFile?: (
    path: string,
    content: string,
    options?: FileWriteOptions,
  ) => Promise<FileWriteResult | void>;
  /** Optional delete. Only offered when defined. */
  deleteFile?: (path: string, type?: FileEntry["type"]) => Promise<void>;
  /** Optional folder creation. */
  createFolder?: (path: string) => Promise<FileWriteResult | void>;
  /** Optional binary-safe upload. */
  uploadFile?: (path: string, file: File) => Promise<FileWriteResult | void>;
  /** Optional atomic move or rename. */
  movePath?: (mutation: FilePathMutation) => Promise<void>;
  /** Optional atomic copy. */
  duplicatePath?: (mutation: FilePathMutation) => Promise<void>;
  /** Optional external link for the "Open on …" action. */
  externalUrl?: (path: string, type: FileEntry["type"]) => string | null;
  /** Optional full-text search capability. */
  search?: (query: string) => Promise<FileSearchResults>;
  /** Optional version history capability. */
  history?: (path: string, limit?: number) => Promise<CommitInfo[]>;
  /** Optional read of a file at a historical version. */
  readVersion?: (path: string, version: string) => Promise<FileContent | null>;
}

const FilesTransportContext = createContext<FilesTransport | null>(null);

export const FilesTransportProvider = FilesTransportContext.Provider;

/** The active storage provider for this workspace. */
export function useFilesTransport(): FilesTransport | null {
  return useContext(FilesTransportContext);
}
