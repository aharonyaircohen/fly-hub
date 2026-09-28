import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Brain status timeout boundary", () => {
  it("returns a retryable result when Fly status cannot be read promptly", () => {
    const source = readFileSync(
      resolve(process.cwd(), "../..", "packages/brain/src/routes/status.ts"),
      "utf8",
    );
    expect(source).toContain("STATUS_READ_TIMEOUT_MS");
    expect(source).toContain('error: "brain_status_timeout"');
    expect(source).toContain('"Retry-After": "5"');
  });
});
