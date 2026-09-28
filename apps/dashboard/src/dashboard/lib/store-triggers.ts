import type { Octokit } from "@octokit/rest";

import {
  buildCompanyStoreHtmlUrl,
  companyStoreAssetPath,
  listCompanyStoreAssetSlugs,
  readCompanyStoreText,
} from "@kody-ade/base/company-store/assets";
import { isSystemEventName } from "@kody-ade/base/events";
import {
  triggerConfigSchema,
  type TriggerConfig,
} from "@kody-ade/base/triggers";

const ID = /^[a-z][a-z0-9-]{0,127}$/;

export interface StoreTrigger {
  slug: string;
  trigger: TriggerConfig;
  target: {
    kind: "workflow" | "pipeline";
    id: string;
  };
  htmlUrl: string;
}

export async function listStoreTriggers(
  octokit: Octokit,
): Promise<StoreTrigger[]> {
  const slugs = await listCompanyStoreAssetSlugs(octokit, "triggers", (slug) =>
    ID.test(slug),
  );
  const triggers = await Promise.all(
    slugs.map((slug) => readStoreTrigger(octokit, slug)),
  );
  return triggers.filter(
    (trigger): trigger is StoreTrigger => trigger !== null,
  );
}

export async function readStoreTrigger(
  octokit: Octokit,
  slug: string,
): Promise<StoreTrigger | null> {
  if (!ID.test(slug)) return null;
  const root = await companyStoreAssetPath(octokit, "triggers", slug);
  const content = await readCompanyStoreText(octokit, `${root}/trigger.json`);
  if (!content) return null;
  try {
    const trigger = triggerConfigSchema.parse(JSON.parse(content));
    if (trigger.id !== slug || !isSystemEventName(trigger.event)) return null;
    if (
      trigger.action.type !== "start-workflow" &&
      trigger.action.type !== "start-pipeline"
    ) {
      return null;
    }
    return {
      slug,
      trigger,
      target:
        trigger.action.type === "start-workflow"
          ? { kind: "workflow", id: trigger.action.workflowId }
          : { kind: "pipeline", id: trigger.action.pipelineId },
      htmlUrl: buildCompanyStoreHtmlUrl("triggers", slug),
    };
  } catch {
    return null;
  }
}
