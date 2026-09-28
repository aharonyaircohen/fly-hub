import { slugifyTitle } from "@kody-ade/base/slug";
import type { StoredFileSpaceConfig } from "@dashboard/lib/dashboard-config/types";

export type StoredFileSpace = StoredFileSpaceConfig;

export interface FileSpace extends StoredFileSpace {
  builtIn?: boolean;
}

export const DOCS_FILE_SPACE: FileSpace = {
  id: "docs",
  title: "Docs",
  slug: "docs",
  rootPath: "docs",
  builtIn: true,
};

const RESERVED_SLUGS = new Set(["docs", "new"]);

function slugForTitle(title: string): string {
  return slugifyTitle(title, {
    maxLength: 48,
    fallback: "",
    allowUnderscore: false,
  });
}

function isSafeFileSpaceSegment(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 48 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    slugForTitle(value) === value
  );
}

export function normalizeFileSpaces(value: unknown): FileSpace[] {
  if (!Array.isArray(value)) return [DOCS_FILE_SPACE];
  const custom = value.filter((item): item is StoredFileSpace => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<StoredFileSpace>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.slug === "string" &&
      typeof candidate.rootPath === "string" &&
      candidate.id === candidate.slug &&
      candidate.rootPath === candidate.slug &&
      isSafeFileSpaceSegment(candidate.slug) &&
      !RESERVED_SLUGS.has(candidate.slug)
    );
  });
  return [DOCS_FILE_SPACE, ...custom];
}

export function createFileSpace(
  rawTitle: string,
  existing: readonly FileSpace[],
): StoredFileSpace {
  const title = rawTitle.trim();
  if (!title) throw new Error("Enter a name for the file space");
  if (title.length > 64) throw new Error("Name must be 64 characters or less");
  const slug = slugForTitle(title);
  if (!slug) throw new Error("Name must contain letters or numbers");
  if (RESERVED_SLUGS.has(slug)) throw new Error(`“${slug}” is reserved`);
  if (existing.some((space) => space.slug === slug)) {
    throw new Error(`A file space named “${title}” already exists`);
  }
  return { id: slug, title, slug, rootPath: slug };
}

export function updateFileSpace(
  space: StoredFileSpace,
  patch: { title: string },
): StoredFileSpace {
  const title = patch.title.trim();
  if (!title) throw new Error("Enter a name for the file space");
  if (title.length > 64) throw new Error("Name must be 64 characters or less");
  return { ...space, title };
}

export function reorderFileSpaces(
  spaces: readonly StoredFileSpace[],
  ids: readonly string[],
): StoredFileSpace[] {
  if (
    ids.length !== spaces.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !spaces.some((space) => space.id === id))
  ) {
    throw new Error("Order must include every file space exactly once");
  }
  const byId = new Map(spaces.map((space) => [space.id, space]));
  return ids.map((id) => byId.get(id)!);
}
