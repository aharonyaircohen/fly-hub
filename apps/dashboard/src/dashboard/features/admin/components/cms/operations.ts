import type {
  CmsCollectionConfig,
  CmsPermissionsConfig,
  CmsRole,
} from "@kody-ade/cms/types";
import {
  canWriteOperation,
  rolesForWriteOperation,
  type CmsWriteOperation,
} from "@kody-ade/cms/permissions";

export { canWriteOperation };
export type { CmsWriteOperation };

export function writeDisabledReason(
  collection: CmsCollectionConfig,
  operation: CmsWriteOperation,
  actorRole: CmsRole = "admin",
  permissions?: CmsPermissionsConfig,
): string {
  if (!collection.operations[operation]) return "Operation disabled";
  if (collection.writePolicy === "approval-required")
    return "Approval required";
  if (collection.writePolicy === "read-only") return "Read-only";
  if (
    !rolesForWriteOperation(collection, operation, permissions).includes(
      actorRole,
    )
  ) {
    return `${roleLabel(actorRole)} role cannot ${operation}`;
  }
  return "Operation disabled";
}

function roleLabel(role: CmsRole): string {
  if (role === "admin") return "Admin";
  if (role === "editor") return "Editor";
  return "Viewer";
}
