/**
 * @fileType types
 * @domain user-state
 * @pattern user-state-contract
 * @ai-summary The user-state contract: namespaces (entities) with versioned
 *   schemas and adapter bindings, the per-user document shape, the narrow
 *   adapter interface, and the typed error. Everything in kody reads/writes
 *   user data through this contract only.
 */
import type { z } from "zod";
import type { Octokit } from "@octokit/rest";

/** How a write combines with the existing document. */
export type UserStateMergePolicy = "replace" | "shallow-merge";

/** A registered user-state namespace (entity). */
export interface UserStateNamespace {
  /** Lowercase slug, e.g. "profile", "quiz_answers". */
  readonly name: string;
  readonly version: number;
  /** Core namespaces ship in kody code; brand namespaces come from config. */
  readonly origin: "core" | "brand";
  readonly schema: z.ZodType<Record<string, unknown>>;
  /** Adapter name, e.g. "convex". */
  readonly adapter: string;
  readonly merge: UserStateMergePolicy;
  /** Whether the chat model may write this namespace via the save tool. */
  readonly modelWritable: boolean;
}

/** A user's stored document for one namespace. */
export interface UserStateDoc {
  readonly version: number;
  readonly namespace: string;
  readonly userId: string;
  readonly updatedAt: string;
  readonly data: Record<string, unknown>;
  /**
   * Storage revision (e.g. git blob sha) of the read this doc came from.
   * Writes pass it back so a concurrent writer causes a conflict instead
   * of a silent lost update. Not persisted into the stored document.
   */
  readonly revision?: string | null;
}

/** Context adapters need to reach the brand's storage. */
export interface UserStateAdapterContext {
  readonly octokit: Octokit;
  readonly owner: string;
  readonly repo: string;
}

/**
 * The narrow storage seam. Core state uses "convex"; a CMS bridge (e.g.
 * MongoDB) implements the same two methods later with no contract change.
 */
export interface UserStateAdapter {
  readonly name: string;
  get(
    ctx: UserStateAdapterContext,
    userId: string,
    namespace: UserStateNamespace,
  ): Promise<UserStateDoc | null>;
  set(
    ctx: UserStateAdapterContext,
    userId: string,
    namespace: UserStateNamespace,
    doc: UserStateDoc,
    opts?: {
      /**
       * Concurrency token: the `revision` of the get() this write was
       * merged from — `null` means "the doc must not exist yet". When
       * present, a concurrent write makes the set fail (409/422) so the
       * caller re-merges; when undefined the adapter writes best-effort.
       */
      expectedRevision?: string | null;
    },
  ): Promise<void>;
}

export type UserStateErrorCode =
  | "namespace_not_found"
  | "adapter_not_found"
  | "validation_failed"
  | "not_authenticated"
  | "config_invalid";

const ERROR_STATUS: Record<UserStateErrorCode, number> = {
  namespace_not_found: 404,
  adapter_not_found: 400,
  validation_failed: 422,
  not_authenticated: 401,
  config_invalid: 400,
};

export class UserStateError extends Error {
  readonly code: UserStateErrorCode;
  readonly status: number;
  readonly issues: string[];

  constructor(
    code: UserStateErrorCode,
    message: string,
    issues: string[] = [],
  ) {
    super(message);
    this.name = "UserStateError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.issues = issues;
  }
}
