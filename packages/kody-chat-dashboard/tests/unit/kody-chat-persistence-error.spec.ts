import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/KodyChat.tsx"),
  "utf8",
);

describe("Kody chat persistence errors", () => {
  it("shows the persistence error returned by the conversation API", () => {
    expect(source).toContain("{sessionHook.persistenceError}");
    expect(source).not.toContain(
      "Conversation could not be saved. Check your connection and try",
    );
  });
});
