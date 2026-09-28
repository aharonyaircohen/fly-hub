/**
 * @fileType util
 * @domain kody
 * @pattern company-export
 * @ai-summary Build a portable Company bundle from the connected repo.
 *   Reads the company-level artifact types (agents, commands, context,
 *   capabilities and instructions via their existing file helpers
 *   and maps each to the repo-agnostic shape in `types.ts` — dropping
 *   sha/html_url/commit and tick timestamps, which are meaningless in another repo. Runs inside
 *   an established GitHub context (see the API route).
 */

import { getOctokit, getOwner, getRepo } from "../github-client";
import { listAgentFiles } from "../agent-files";
import { listRepoCommandFiles } from "@kody-ade/workspace/commands/files";
import { listContextFiles } from "@kody-ade/workspace/context/files";
import { readInstructionsFile } from "@kody-ade/workspace/instructions/files";
import {
  listLocalCapabilityFiles,
  readCapabilityFolderFiles,
} from "@kody-ade/agency/capabilities";
import { getEngineConfig } from "@kody-ade/base/engine/config";
import {
  COMPANY_BUNDLE_VERSION,
  type CompanyBundle,
  type CompanyConfigBundle,
  type CompanyAgentEntry,
  type CompanyCommandEntry,
  type CompanyCapabilityEntry,
  type CompanyContextEntry,
} from "./types";
import type { TickFile } from "../ticked/files";
import type { CommandFile } from "@kody-ade/workspace/commands/files";
import type { ContextFile } from "@kody-ade/workspace/context/files";

function toAgentEntry(file: TickFile): CompanyAgentEntry {
  return {
    slug: file.slug,
    title: file.title,
    body: file.body,
  };
}

function toCommandEntry(file: CommandFile): CompanyCommandEntry {
  return {
    slug: file.slug,
    description: file.description,
    argumentHint: file.argumentHint,
    body: file.body,
  };
}

function toContextEntry(file: ContextFile): CompanyContextEntry {
  return {
    slug: file.slug,
    body: file.body,
    agent: file.agent,
  };
}

/** Read every capability folder into portable path→content maps. */
async function buildCapabilityEntries(): Promise<CompanyCapabilityEntry[]> {
  const summaries = await listLocalCapabilityFiles();
  const entries = await Promise.all(
    summaries.map(async (s) => {
      const files = await readCapabilityFolderFiles(s.slug);
      return files ? { slug: s.slug, files } : null;
    }),
  );
  return entries.filter((e): e is NonNullable<typeof e> => e !== null);
}

/**
 * Read the portable engine-config slice from kody.config.json. Only fields
 * that are actually set are emitted, so an unconfigured repo exports `null`
 * rather than a bag of empties. The default branch is intentionally omitted —
 * it's repo-specific, not company-level.
 */
async function buildConfigBundle(): Promise<CompanyConfigBundle | null> {
  const { config } = await getEngineConfig(getOctokit(), getOwner(), getRepo());
  const out: CompanyConfigBundle = {};

  const quality: NonNullable<CompanyConfigBundle["quality"]> = {};
  for (const k of ["typecheck", "lint", "format", "testUnit"] as const) {
    const v = config.quality?.[k]?.trim();
    if (v) quality[k] = v;
  }
  if (Object.keys(quality).length > 0) out.quality = quality;

  if (config.aliases && Object.keys(config.aliases).length > 0) {
    out.aliases = config.aliases;
  }
  const assoc = config.access?.allowedAssociations;
  if (Array.isArray(assoc) && assoc.length > 0) out.allowedAssociations = assoc;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Read every company-level artifact from the connected repo and assemble
 * the portable bundle. The reads are independent — fan them out.
 * Only repo-defined commands are exported (built-ins ship with the
 * dashboard, so re-importing them would be redundant).
 */
export async function buildCompanyBundle(): Promise<CompanyBundle> {
  const [agent, contexts, commandsResult, capabilities, instructions, config] =
    await Promise.all([
      listAgentFiles(),
      listContextFiles(),
      listRepoCommandFiles(),
      buildCapabilityEntries(),
      readInstructionsFile(),
      buildConfigBundle(),
    ]);

  return {
    kodyCompany: COMPANY_BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    exportedFrom: `${getOwner()}/${getRepo()}`,
    agent: agent.map(toAgentEntry),
    contexts: contexts.map(toContextEntry),
    commands: commandsResult.commands
      .filter((p) => p.source === "repo")
      .map(toCommandEntry),
    capabilities,
    instructions: instructions?.body?.trim() ? instructions.body : null,
    config,
  };
}
