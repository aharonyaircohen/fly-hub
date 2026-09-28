/**
 * @fileType utility
 * @domain brain
 * @pattern brain-image-catalog
 *
 * Shared Brain image catalog resolution. The durable state file is primary,
 * and GHCR discovery fills in recently pushed images that have not been
 * written back to state yet.
 */
import "server-only";

import { createHash } from "node:crypto";

import { logger } from "@kody-ade/base/logger";
import { createServerTtlCache } from "@kody-ade/base/server-ttl-cache";
import { brainGhcrImageRef } from "./image-save";
import type { BrainImageFile, BrainSavedImage } from "./store";

interface GitHubPackageVersion {
  id?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  metadata?: {
    container?: {
      tags?: unknown;
    };
  };
}

export class BrainPackageImageError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "BrainPackageImageError";
  }
}

const IMAGE_TAG_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const DISCOVERED_IMAGES_TTL_MS = 60_000;
const discoveredImagesCache = createServerTtlCache<BrainSavedImage[]>({
  ttlMs: DISCOVERED_IMAGES_TTL_MS,
});

function tokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function brainImagePackage(input: { owner: string; account: string }): {
  baseRef: string;
  packageName: string;
} {
  const ref = brainGhcrImageRef({
    owner: input.owner,
    account: input.account,
    tag: "probe",
  });
  const baseRef = ref.replace(/:probe$/, "");
  const packageName = baseRef.split("/").at(-1);
  if (!packageName) {
    throw new Error("Invalid Brain image package");
  }
  return { baseRef, packageName };
}

function packageVersionUrl(input: {
  ownerKind: "orgs" | "users";
  owner: string;
  packageName: string;
  page: number;
}): string {
  const owner = encodeURIComponent(input.owner);
  const packageName = encodeURIComponent(input.packageName);
  return `https://api.github.com/${input.ownerKind}/${owner}/packages/container/${packageName}/versions?per_page=100&page=${input.page}`;
}

function packageVersionDeleteUrl(input: {
  ownerKind: "orgs" | "users";
  owner: string;
  packageName: string;
  versionId: number;
}): string {
  return `${packageVersionUrl({
    ownerKind: input.ownerKind,
    owner: input.owner,
    packageName: input.packageName,
    page: 1,
  }).replace(/\?per_page=100&page=1$/, "")}/${input.versionId}`;
}

function packageHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function packageVersionTags(version: GitHubPackageVersion): string[] {
  const tags = version.metadata?.container?.tags;
  return Array.isArray(tags)
    ? tags.filter(
        (tag): tag is string =>
          typeof tag === "string" && IMAGE_TAG_RE.test(tag),
      )
    : [];
}

function sortBrainSavedImages(images: BrainSavedImage[]): BrainSavedImage[] {
  return [...images].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function brainImageCatalogFile(input: {
  previous: BrainImageFile | null;
  images: BrainSavedImage[];
  createdAt?: string;
  updatedAt?: string;
}): BrainImageFile {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const images = sortBrainSavedImages(input.images);
  const imageRefs = new Set(images.map((image) => image.imageRef));
  const forgottenImageRefs = (input.previous?.forgottenImageRefs ?? []).filter(
    (imageRef) => !imageRefs.has(imageRef),
  );
  return {
    version: 1,
    createdAt:
      input.previous?.createdAt ??
      input.createdAt ??
      images[0]?.createdAt ??
      updatedAt,
    updatedAt,
    images,
    ...(forgottenImageRefs.length > 0 ? { forgottenImageRefs } : {}),
  };
}

export function upsertBrainCatalogImageFile(
  previous: BrainImageFile | null,
  image: BrainSavedImage,
  updatedAt = new Date().toISOString(),
): BrainImageFile {
  const images = [
    image,
    ...(previous?.images ?? []).filter(
      (saved) => saved.imageRef !== image.imageRef,
    ),
  ];
  return brainImageCatalogFile({
    previous,
    images,
    createdAt: image.createdAt,
    updatedAt,
  });
}

function savedImagesFromPackageVersions(
  versions: GitHubPackageVersion[],
  baseRef: string,
): BrainSavedImage[] {
  const images: BrainSavedImage[] = [];
  for (const version of versions) {
    const tags = version.metadata?.container?.tags;
    if (!Array.isArray(tags)) continue;
    const createdAt =
      typeof version.created_at === "string"
        ? version.created_at
        : new Date().toISOString();
    const updatedAt =
      typeof version.updated_at === "string" ? version.updated_at : createdAt;
    for (const tag of tags) {
      if (typeof tag !== "string" || !IMAGE_TAG_RE.test(tag)) continue;
      images.push({
        imageRef: `${baseRef}:${tag}`,
        createdAt,
        updatedAt,
      });
    }
  }
  return sortBrainSavedImages(images);
}

export function mergeBrainSavedImages(
  image: BrainImageFile | null,
  discoveredImages: BrainSavedImage[],
): BrainSavedImage[] {
  const merged = new Map<string, BrainSavedImage>();
  const forgotten = new Set(image?.forgottenImageRefs ?? []);
  for (const discovered of discoveredImages) {
    if (forgotten.has(discovered.imageRef)) continue;
    merged.set(discovered.imageRef, discovered);
  }
  for (const saved of image?.images ?? []) {
    if (forgotten.has(saved.imageRef)) continue;
    if (!merged.has(saved.imageRef)) {
      merged.set(saved.imageRef, saved);
    }
  }
  if (
    image?.imageRef &&
    !forgotten.has(image.imageRef) &&
    !merged.has(image.imageRef)
  ) {
    merged.set(image.imageRef, {
      imageRef: image.imageRef,
      createdAt: image.createdAt,
      updatedAt: image.updatedAt,
    });
  }
  return sortBrainSavedImages([...merged.values()]);
}

async function fetchBrainPackageImages(input: {
  owner: string;
  account: string;
  githubToken: string;
}): Promise<BrainSavedImage[]> {
  const { baseRef, packageName } = brainImagePackage(input);
  for (const ownerKind of ["orgs", "users"] as const) {
    const versions: GitHubPackageVersion[] = [];
    let page = 1;
    while (page <= 10) {
      const res = await fetch(
        packageVersionUrl({
          ownerKind,
          owner: input.owner,
          packageName,
          page,
        }),
        {
          headers: packageHeaders(input.githubToken),
        },
      );
      if (res.status === 404 && page === 1) {
        break;
      }
      if (!res.ok) {
        throw new Error(`GitHub package versions lookup failed: ${res.status}`);
      }
      const pageVersions = (await res.json()) as unknown;
      if (!Array.isArray(pageVersions) || pageVersions.length === 0) {
        return savedImagesFromPackageVersions(versions, baseRef);
      }
      versions.push(...(pageVersions as GitHubPackageVersion[]));
      if (pageVersions.length < 100) {
        return savedImagesFromPackageVersions(versions, baseRef);
      }
      page += 1;
    }
  }
  return [];
}

export async function deleteBrainPackageImage(input: {
  owner: string;
  repo: string;
  account: string;
  githubToken: string;
  imageRef: string;
}): Promise<{ deletedImageRefs: string[]; alreadyMissing: boolean }> {
  const { baseRef, packageName } = brainImagePackage(input);
  const prefix = `${baseRef}:`;
  const tag = input.imageRef.startsWith(prefix)
    ? input.imageRef.slice(prefix.length)
    : "";
  if (!IMAGE_TAG_RE.test(tag)) {
    throw new BrainPackageImageError(
      "Brain image does not belong to this user's Brain package.",
      400,
      "brain_image_ref_not_owned",
    );
  }

  for (const ownerKind of ["orgs", "users"] as const) {
    let page = 1;
    while (page <= 10) {
      const listUrl = packageVersionUrl({
        ownerKind,
        owner: input.owner,
        packageName,
        page,
      });
      const listRes = await fetch(listUrl, {
        headers: packageHeaders(input.githubToken),
      });
      if (listRes.status === 404 && page === 1) break;
      if (!listRes.ok) {
        throw new BrainPackageImageError(
          `GitHub package versions lookup failed (${listRes.status}).`,
          listRes.status,
          listRes.status === 403
            ? "brain_image_package_delete_forbidden"
            : "brain_image_package_lookup_failed",
        );
      }
      const pageVersions = (await listRes.json()) as unknown;
      if (!Array.isArray(pageVersions)) {
        throw new BrainPackageImageError(
          "GitHub returned an invalid package version list.",
          502,
          "brain_image_package_lookup_failed",
        );
      }
      for (const rawVersion of pageVersions) {
        const version = rawVersion as GitHubPackageVersion;
        const tags = packageVersionTags(version);
        if (!tags.includes(tag)) continue;
        if (
          typeof version.id !== "number" ||
          !Number.isSafeInteger(version.id) ||
          version.id <= 0
        ) {
          throw new BrainPackageImageError(
            "GitHub package version is missing its identifier.",
            502,
            "brain_image_package_lookup_failed",
          );
        }
        const deleteRes = await fetch(
          packageVersionDeleteUrl({
            ownerKind,
            owner: input.owner,
            packageName,
            versionId: version.id,
          }),
          {
            method: "DELETE",
            headers: packageHeaders(input.githubToken),
          },
        );
        if (!deleteRes.ok) {
          throw new BrainPackageImageError(
            deleteRes.status === 403
              ? "GitHub denied package deletion. The token needs package admin and delete permission."
              : `GitHub package deletion failed (${deleteRes.status}).`,
            deleteRes.status,
            deleteRes.status === 403
              ? "brain_image_package_delete_forbidden"
              : "brain_image_package_delete_failed",
          );
        }
        clearBrainPackageImageDiscoveryCache();
        return {
          deletedImageRefs: tags.map((savedTag) => `${baseRef}:${savedTag}`),
          alreadyMissing: false,
        };
      }
      if (pageVersions.length < 100) break;
      page += 1;
    }
  }

  clearBrainPackageImageDiscoveryCache();
  return { deletedImageRefs: [input.imageRef], alreadyMissing: true };
}

export async function discoverBrainPackageImages(
  input: {
    owner: string;
    repo: string;
    account: string;
    githubToken: string;
  },
  options: { refresh?: boolean; scope?: string } = {},
): Promise<BrainSavedImage[]> {
  const cacheKey = `${input.owner}/${input.repo}:${input.account}:${options.scope ?? "catalog"}:${tokenKey(
    input.githubToken,
  )}`;
  try {
    if (options.refresh) discoveredImagesCache.delete(cacheKey);
    return await discoveredImagesCache.get(cacheKey, () =>
      fetchBrainPackageImages(input),
    );
  } catch (err) {
    logger.warn(
      { err, owner: input.owner, repo: input.repo },
      "brain image GHCR history lookup failed",
    );
    return [];
  }
}

export function clearBrainPackageImageDiscoveryCache() {
  discoveredImagesCache.clear();
}
