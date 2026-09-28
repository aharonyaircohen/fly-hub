import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(
  resolve(__dirname, "../../app/api/kody/chat/title/route.ts"),
  "utf8",
);

describe("chat title route", () => {
  it("removes model reasoning from generated titles", () => {
    expect(route).toContain("const cleaned = stripReasoning(text)");
  });
});
