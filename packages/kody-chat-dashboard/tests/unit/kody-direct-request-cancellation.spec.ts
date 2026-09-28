import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROUTE_SOURCE = readFileSync(
  resolve(__dirname, "../../app/api/kody/chat/kody/route.ts"),
  "utf8",
);

describe("Kody Direct request cancellation", () => {
  it("passes the browser request cancellation signal to every main model turn", () => {
    expect(ROUTE_SOURCE).toContain("abortSignal: req.signal,");
  });
});
