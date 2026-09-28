import type { Octokit } from "@octokit/rest";
import {
  formatStrategyBlueprintIssues,
  validateStrategyBlueprint,
  type StrategyBlueprint,
} from "@kody-ade/engine-contracts";
import {
  companyStoreAssetPath,
  readCompanyStoreText,
} from "@kody-ade/base/company-store/assets";

const STRATEGY_ID = /^[a-z][a-z0-9-]{0,127}$/;

export async function readStoreStrategy(
  octokit: Octokit,
  id: string,
): Promise<{ blueprint: StrategyBlueprint; instructions: string } | null> {
  if (!STRATEGY_ID.test(id)) return null;
  const root = await companyStoreAssetPath(octokit, "strategies", id);
  const raw = await readCompanyStoreText(octokit, `${root}/strategy.json`);
  if (raw === null) return null;
  const value = JSON.parse(raw) as unknown;
  const issues = validateStrategyBlueprint(value);
  if (issues.length > 0) {
    throw new Error(
      `Store Strategy "${id}" is invalid: ${formatStrategyBlueprintIssues(issues).join("; ")}`,
    );
  }
  const blueprint = value as StrategyBlueprint;
  if (blueprint.id !== id) {
    throw new Error(`Store Strategy "${id}" has a mismatched id`);
  }
  const instructions = await readCompanyStoreText(
    octokit,
    `${root}/${blueprint.instructions}`,
  );
  if (!instructions?.trim()) {
    throw new Error(`Store Strategy "${id}" has no instructions`);
  }
  return { blueprint, instructions };
}
