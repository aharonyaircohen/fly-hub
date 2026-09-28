import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/VoiceButton.tsx"),
  "utf8",
);
const COMPOSER_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/chat/surface/Composer.tsx"),
  "utf8",
);

describe("voice menu row", () => {
  it("uses the same default menu-row treatment as the other composer actions", () => {
    expect(SOURCE).toContain(
      '"flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors select-none hover:bg-accent"',
    );
  });

  it("uses the chat package's VoiceButton instead of a host-local duplicate", () => {
    expect(COMPOSER_SOURCE).toContain(
      'from "../../components/VoiceButton"',
    );
  });
});
