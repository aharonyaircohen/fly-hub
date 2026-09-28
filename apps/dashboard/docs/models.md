# Chat Models

The repository-scoped `/models` page manages the models available to Chat and
the Engine. API keys remain in [Secrets](./secrets-vault.md); model entries
store only the secret name.

## Built-in models

Kody includes code-owned model templates in the same catalog as user-managed
models. They can be enabled, disabled, or edited, but not deleted. Ox Alpha
uses its official OpenAI-compatible endpoint and requires `OXALPHA_API_KEY` in
Secrets, like OpenRouter requires `OPENROUTER_API_KEY`. It is optional and is
not a Chat or Engine default.

## Automatic

Automatic is an ordered fallback choice built from the existing model list.

1. Turn on **Auto** for at least two enabled models.
2. Use the up and down controls to set their fallback order.
3. Select **Chat default** to make new chats start with Automatic.
4. Select **Engine default** to make Engine runs use Automatic.

The Chat and Engine defaults are independent. Selecting Automatic for one does
not change the other. Selecting a specific model manually uses only that model
and does not activate fallback.

Every model included in Automatic must have its named API-key secret
configured. Automatic currently reports `model_api_key_missing` before sending
the request if any selected model is missing its key.

## Stored configuration

- `LLM_MODELS` stores model definitions, enabled state, Automatic membership,
  order, and individual Chat or Engine defaults.
- `LLM_AUTOMATIC` stores whether Automatic is the Chat default, the Engine
  default, or both.
- When Automatic is the Engine default, `/models` writes `automatic` to
  `agent.model` and writes the ordered candidates to `agent.automaticModels` in
  `kody.config.json`.

See [Engine configuration](./engine-config.md) for the Engine-side model
contract and [Variables](./variables.md) for storage details.
