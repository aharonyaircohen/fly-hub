import type {
  CmsCollectionConfig,
  CmsContentOperation,
  CmsPermissionsConfig,
  CmsRole,
} from "./types";

export type CmsWriteOperation = Extract<
  CmsContentOperation,
  "create" | "update" | "delete"
>;

const DEFAULT_WRITE_PERMISSIONS: Record<CmsWriteOperation, CmsRole[]> = {
  create: ["editor", "admin"],
  update: ["editor", "admin"],
  delete: ["admin"],
};

export function canWriteOperation(
  collection: CmsCollectionConfig,
  operation: CmsWriteOperation,
  actorRole: CmsRole = "admin",
  permissions?: CmsPermissionsConfig,
): boolean {
  if (
    !collection.operations[operation] ||
    collection.writePolicy !== "enabled"
  ) {
    return false;
  }
  return rolesForWriteOperation(collection, operation, permissions).includes(
    actorRole,
  );
}

export function rolesForWriteOperation(
  collection: CmsCollectionConfig,
  operation: CmsWriteOperation,
  permissions?: CmsPermissionsConfig,
): CmsRole[] {
  return (
    collection.permissions?.content?.[operation] ??
    permissions?.content?.[operation] ??
    DEFAULT_WRITE_PERMISSIONS[operation]
  );
}
