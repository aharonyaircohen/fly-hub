import type { Octokit } from "@octokit/rest";

import {
  buildCompanyStoreHtmlUrl,
  companyStoreAssetPath,
  listCompanyStoreAssetSlugs,
  readCompanyStoreText,
} from "@kody-ade/base/company-store/assets";
import {
  createLoopDefinition,
  type LoopDefinition,
} from "@kody-ade/agency-domain";

const ID = /^[a-z][a-z0-9-]{0,127}$/;

export interface StoreLoop {
  slug: string;
  loop: LoopDefinition;
  htmlUrl: string;
}

export async function listStoreLoops(octokit: Octokit): Promise<StoreLoop[]> {
  const slugs = await listCompanyStoreAssetSlugs(octokit, "loops", (slug) =>
    ID.test(slug),
  );
  const loops = await Promise.all(
    slugs.map((slug) => readStoreLoop(octokit, slug)),
  );
  return loops.filter((loop): loop is StoreLoop => loop !== null);
}

export async function readStoreLoop(
  octokit: Octokit,
  slug: string,
): Promise<StoreLoop | null> {
  if (!ID.test(slug)) return null;
  const root = await companyStoreAssetPath(octokit, "loops", slug);
  const content = await readCompanyStoreText(octokit, `${root}/loop.json`);
  if (!content) return null;
  try {
    const loop = createLoopDefinition(JSON.parse(content));
    if (loop.id !== slug) return null;
    return {
      slug,
      loop,
      htmlUrl: buildCompanyStoreHtmlUrl("loops", slug),
    };
  } catch {
    return null;
  }
}
