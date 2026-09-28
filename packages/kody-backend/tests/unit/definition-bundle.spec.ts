import { describe, expect, it } from "vitest";
import {
  definitionVersion,
  normalizeDefinitionFiles,
} from "../../src/definition-bundle";

describe("definition bundles", () => {
  it("produces the same version regardless of object insertion order", () => {
    const first = {
      schemaVersion: 1 as const,
      files: { "profile.json": "{}", "capability.md": "Run" },
    };
    const second = {
      schemaVersion: 1 as const,
      files: { "capability.md": "Run", "profile.json": "{}" },
    };

    expect(definitionVersion(first)).toBe(definitionVersion(second));
    expect(definitionVersion(first)).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("rejects unsafe paths and normalizes line endings", () => {
    expect(() => normalizeDefinitionFiles({ "../secret": "x" })).toThrow(
      "unsafe definition path",
    );
    expect(
      normalizeDefinitionFiles({ "skills/check/SKILL.md": "a\r\nb" }),
    ).toEqual({
      "skills/check/SKILL.md": "a\nb",
    });
  });
});
