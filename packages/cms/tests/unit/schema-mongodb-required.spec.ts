import { describe, expect, it } from "vitest";

import { extractValidatorRequiredFields } from "../../src/schema/mongodb";

describe("extractValidatorRequiredFields", () => {
  it("reads required field names from a $jsonSchema validator", () => {
    const required = extractValidatorRequiredFields({
      validator: {
        $jsonSchema: {
          bsonType: "object",
          required: ["title", "status"],
          properties: {},
        },
      },
    });
    expect([...required].sort()).toEqual(["status", "title"]);
  });

  it("ignores _id and non-string entries", () => {
    const required = extractValidatorRequiredFields({
      validator: {
        $jsonSchema: { required: ["_id", "", 42, "email"] },
      },
    });
    expect([...required]).toEqual(["email"]);
  });

  it("returns empty for collections without validators", () => {
    expect(extractValidatorRequiredFields(undefined).size).toBe(0);
    expect(extractValidatorRequiredFields({}).size).toBe(0);
    expect(extractValidatorRequiredFields({ validator: {} }).size).toBe(0);
    expect(
      extractValidatorRequiredFields({ validator: { $jsonSchema: {} } }).size,
    ).toBe(0);
  });
});
