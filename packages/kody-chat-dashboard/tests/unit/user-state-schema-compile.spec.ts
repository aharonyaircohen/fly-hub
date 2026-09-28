/**
 * Unit tests for the user-state field-spec compiler
 * (src/dashboard/lib/user-state/schema-compile.ts).
 */
import { describe, it, expect } from "vitest";

import {
  compileNamespaceSchema,
  namespaceSpecSchema,
} from "../../src/dashboard/lib/user-state/schema-compile";

describe("namespaceSpecSchema", () => {
  it("accepts a minimal valid spec and applies defaults", () => {
    const spec = namespaceSpecSchema.parse({
      name: "quiz_results",
      fields: [{ name: "score", type: "number" }],
    });
    expect(spec.version).toBe(1);
    expect(spec.adapter).toBe("convex");
    expect(spec.merge).toBe("shallow-merge");
    expect(spec.modelWritable).toBe(false);
  });

  it("rejects bad namespace slugs", () => {
    for (const name of ["Quiz", "1abc", "with space", ""]) {
      expect(
        namespaceSpecSchema.safeParse({
          name,
          fields: [{ name: "a", type: "string" }],
        }).success,
      ).toBe(false);
    }
  });

  it("rejects unknown spec keys", () => {
    expect(
      namespaceSpecSchema.safeParse({
        name: "ok",
        fields: [{ name: "a", type: "string" }],
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("compileNamespaceSchema", () => {
  it("enforces required, optional, and constraints", () => {
    const schema = compileNamespaceSchema([
      { name: "email", type: "string", required: true, pattern: "^\\S+@\\S+$" },
      { name: "age", type: "number", required: false, min: 0, max: 150 },
      { name: "tags", type: "stringArray", required: false, max: 3 },
      { name: "active", type: "boolean", required: false },
      { name: "meta", type: "json", required: false },
    ]);

    expect(
      schema.safeParse({ email: "a@b.c", age: 30, active: true }).success,
    ).toBe(true);
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(schema.safeParse({ email: "a@b.c", age: 200 }).success).toBe(false);
    expect(
      schema.safeParse({ email: "a@b.c", tags: ["1", "2", "3", "4"] }).success,
    ).toBe(false);
    expect(schema.safeParse({ email: "a@b.c", unknown: 1 }).success).toBe(
      false,
    );
  });
});
