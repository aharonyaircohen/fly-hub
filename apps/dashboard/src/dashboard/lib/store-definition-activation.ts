import {
  definitionVersion,
  type DefinitionBundle,
} from "@kody-ade/backend/definition-bundle";

type DefinitionKind = "agent" | "capability" | "asset";

interface PublishDefinitionInput {
  tenantId: string;
  kind: DefinitionKind;
  slug: string;
  version: string;
  bundle: DefinitionBundle;
  source: "store";
  createdAt: string;
}

export interface StoreExecutionDefinitions {
  tenantId: string;
  agents: Readonly<Record<string, string>>;
  capabilities: Readonly<Record<string, Readonly<Record<string, string>>>>;
  shared: Readonly<Record<string, string>>;
  createdAt: string;
  publish(input: PublishDefinitionInput): Promise<unknown>;
}

function definition(
  input: Omit<PublishDefinitionInput, "version" | "source">,
): PublishDefinitionInput {
  return {
    ...input,
    version: definitionVersion(input.bundle),
    source: "store",
  };
}

export async function publishStoreExecutionDefinitions(
  input: StoreExecutionDefinitions,
): Promise<void> {
  const definitions: PublishDefinitionInput[] = [
    ...Object.entries(input.agents).map(([slug, raw]) =>
      definition({
        tenantId: input.tenantId,
        kind: "agent",
        slug,
        bundle: { schemaVersion: 1, files: { "agent.md": raw } },
        createdAt: input.createdAt,
      }),
    ),
    ...Object.entries(input.capabilities).map(([slug, files]) =>
      definition({
        tenantId: input.tenantId,
        kind: "capability",
        slug,
        bundle: { schemaVersion: 1, files: { ...files } },
        createdAt: input.createdAt,
      }),
    ),
    ...(Object.keys(input.shared).length === 0
      ? []
      : [
          definition({
            tenantId: input.tenantId,
            kind: "asset",
            slug: "company-store-shared",
            bundle: { schemaVersion: 1, files: { ...input.shared } },
            createdAt: input.createdAt,
          }),
        ]),
  ];

  await Promise.all(definitions.map((definition) => input.publish(definition)));
}
