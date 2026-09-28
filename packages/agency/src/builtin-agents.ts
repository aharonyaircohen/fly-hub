import type { TickFile } from "@kody-ade/base/ticked/files";

import builtinConfigJson from "./builtin-agents.config.json";
import builtinCapabilitiesConfigJson from "./builtin-capabilities.config.json";

interface BuiltinAgentCapability {
  instructions: string;
  capabilityTools: Array<{ name: string }>;
}

interface BuiltinSpecialistConfig {
  slug: string;
  title: string;
  whenToUse: string;
  instructions: string;
  capabilities?: string[];
  tools: string[];
}

interface BuiltinAgentConfig {
  version: number;
  kody: {
    slug: string;
    title: string;
    instructions: string;
    defaultSubagents: string[];
  };
  specialists: BuiltinSpecialistConfig[];
}

interface BuiltinCapabilityConfig {
  version: number;
  capabilities: Array<{
    slug: string;
    instructions: string;
    tools: string[];
  }>;
}

const builtinConfig = builtinConfigJson as BuiltinAgentConfig;
const builtinCapabilitiesConfig =
  builtinCapabilitiesConfigJson as BuiltinCapabilityConfig;
const CAPABILITY_PREFIX = "builtin-agent-";

export const BUILTIN_SPECIALIST_SLUGS: readonly string[] =
  builtinConfig.kody.defaultSubagents;

function specialistToAgentFile(definition: BuiltinSpecialistConfig): TickFile {
  return {
    slug: definition.slug,
    title: definition.title,
    body: definition.instructions,
    whenToUse: definition.whenToUse,
    sha: "",
    updatedAt: "",
    htmlUrl: "",
    source: "builtin",
    readOnly: true,
    capabilities: [
      `${CAPABILITY_PREFIX}${definition.slug}`,
      ...(definition.capabilities ?? []),
    ],
  };
}

const KODY: TickFile = {
  slug: builtinConfig.kody.slug,
  title: builtinConfig.kody.title,
  body: builtinConfig.kody.instructions,
  sha: "",
  updatedAt: "",
  htmlUrl: "",
  source: "builtin",
  readOnly: true,
  subagents: [...BUILTIN_SPECIALIST_SLUGS],
  lockedSubagents: [...BUILTIN_SPECIALIST_SLUGS],
};

const BUILTIN_AGENTS = [
  KODY,
  ...builtinConfig.specialists.map(specialistToAgentFile),
];

export function listBuiltinAgentFiles(): TickFile[] {
  return BUILTIN_AGENTS.map((agent) => ({
    ...agent,
    ...(agent.capabilities ? { capabilities: [...agent.capabilities] } : {}),
    ...(agent.subagents ? { subagents: [...agent.subagents] } : {}),
    ...(agent.lockedSubagents
      ? { lockedSubagents: [...agent.lockedSubagents] }
      : {}),
  }));
}

export function readBuiltinAgentFile(slug: string): TickFile | null {
  return listBuiltinAgentFiles().find((agent) => agent.slug === slug) ?? null;
}

export function readBuiltinAgentCapability(
  slug: string,
): BuiltinAgentCapability | null {
  const standalone = builtinCapabilitiesConfig.capabilities.find(
    ({ slug: value }) => value === slug,
  );
  if (standalone) {
    return {
      instructions: standalone.instructions,
      capabilityTools: standalone.tools.map((name) => ({ name })),
    };
  }
  if (!slug.startsWith(CAPABILITY_PREFIX)) return null;
  const agentSlug = slug.slice(CAPABILITY_PREFIX.length);
  const definition = builtinConfig.specialists.find(
    ({ slug: value }) => value === agentSlug,
  );
  if (!definition) return null;
  return {
    instructions: `${definition.title} must stay within this responsibility: ${definition.instructions}`,
    capabilityTools: definition.tools.map((name) => ({ name })),
  };
}
