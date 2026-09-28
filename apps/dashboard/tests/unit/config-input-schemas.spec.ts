import { describe, expect, it } from "vitest";
import {
  VariableUpsertSchema,
  ManagedChatModelsSchema,
} from "@kody-ade/base/variables/mutations";
import { SecretUpsertSchema } from "@kody-ade/base/vault/mutations";

describe("shared config input schemas", () => {
  it("uses the same strict name and value contract for variables", () => {
    expect(
      VariableUpsertSchema.safeParse({ name: "valid_name", value: "x" })
        .success,
    ).toBe(false);
    expect(
      VariableUpsertSchema.safeParse({ name: "VALID_NAME", value: "" }).success,
    ).toBe(false);
    expect(
      VariableUpsertSchema.safeParse({ name: "VALID_NAME", value: "x" })
        .success,
    ).toBe(true);
  });

  it("uses the same strict name and value contract for secrets", () => {
    expect(
      SecretUpsertSchema.safeParse({ name: "lowercase", value: "x" }).success,
    ).toBe(false);
    expect(
      SecretUpsertSchema.safeParse({ name: "VALID_SECRET", value: "" }).success,
    ).toBe(false);
    expect(
      SecretUpsertSchema.safeParse({ name: "VALID_SECRET", value: "x" })
        .success,
    ).toBe(true);
  });

  it("rejects more than one default model for either scope", () => {
    const model = {
      id: "openrouter/free",
      label: "Free",
      provider: "openrouter" as const,
      protocol: "openai" as const,
      baseURL: "https://openrouter.ai/api/v1",
      modelName: "openrouter/free",
      apiKeySecret: "OPENROUTER_API_KEY",
    };
    expect(
      ManagedChatModelsSchema.safeParse([
        { ...model, id: "one", default: true },
        { ...model, id: "two", default: true },
      ]).success,
    ).toBe(false);
    expect(
      ManagedChatModelsSchema.safeParse([
        { ...model, id: "one", engineDefault: true },
        { ...model, id: "two", engineDefault: true },
      ]).success,
    ).toBe(false);
  });
});
