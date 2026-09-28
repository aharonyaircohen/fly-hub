interface StoreExecutionDefinition {
  slug: string;
}

export function runnableStoreDefinitionSlugs(
  configured: ReadonlySet<string>,
  definitions: readonly StoreExecutionDefinition[],
): ReadonlySet<string> {
  const published = new Set(definitions.map((definition) => definition.slug));
  return new Set([...configured].filter((slug) => published.has(slug)));
}
