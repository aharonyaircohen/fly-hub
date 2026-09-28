import { afterEach, describe, expect, it, vi } from "vitest";
import { generateText } from "ai";
import {
  ChatModelSchema,
  PROVIDER_PRESETS,
} from "@kody-ade/base/variables/models";
import { chatModelAdapter } from "../../app/api/kody/chat/model-adapters";

afterEach(() => vi.unstubAllGlobals());
const base = {
  id: "free/test",
  provider: "opencode-free",
  ...PROVIDER_PRESETS["opencode-free"],
  label: "Test",
  modelName: "test",
  apiKeySecret: "",
  enabled: true,
};
describe("anonymous OpenCode wire boundary", () => {
  it("requires credentials for other providers and rejects endpoint and engine overrides", () => {
    expect(ChatModelSchema.safeParse(base).success).toBe(true);
    for (const change of [
      { provider: "custom" },
      { baseURL: "https://example.com/v1" },
      { apiKeySecret: "SECRET" },
      { engineDefault: true },
    ]) {
      expect(ChatModelSchema.safeParse({ ...base, ...change }).success).toBe(
        false,
      );
    }
  });
  it.each(["openai-compatible", "openai-responses"] as const)(
    "sends %s to the fixed endpoint with no credentials",
    async (adapter) => {
      const calls: Request[] = [];
      vi.stubGlobal("fetch", async (input: Request) => {
        calls.push(input);
        return new Response(
          JSON.stringify({ error: { message: "Free access is rate limited" } }),
          { status: 429, headers: { "content-type": "application/json" } },
        );
      });
      const config = ChatModelSchema.parse({ ...base, adapter });
      await expect(
        generateText({
          model: chatModelAdapter(config).create(config, "must-not-leak"),
          prompt: "Reply OK",
          maxRetries: 0,
        }),
      ).rejects.toThrow();
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe(
        `https://opencode.ai/zen/v1/${adapter === "openai-responses" ? "responses" : "chat/completions"}`,
      );
      expect(calls[0].headers.has("authorization")).toBe(false);
      expect(await calls[0].text()).not.toContain("must-not-leak");
    },
  );
});
