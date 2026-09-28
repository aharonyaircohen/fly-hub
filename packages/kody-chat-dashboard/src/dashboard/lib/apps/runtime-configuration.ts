export function planAppRuntimeSecrets(input: {
  requestedNames: string[];
  generatedNames?: string[];
  vaultValues: Record<string, string | undefined>;
  generateValue: () => string;
}) {
  const missingNames = input.requestedNames.filter(
    (name) => !input.vaultValues[name],
  );
  const generatedValues = Object.fromEntries(
    (input.generatedNames ?? [])
      .filter((name) => !input.vaultValues[name])
      .map((name) => [name, input.generateValue()]),
  );
  const secretNames = Array.from(
    new Set([...input.requestedNames, ...(input.generatedNames ?? [])]),
  );
  return { missingNames, generatedValues, secretNames };
}
