import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/chat/surface/Composer.tsx"),
  "utf8",
);
const HOST_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/lib/components/kody-chat-terminal-host.tsx",
  ),
  "utf8",
);

describe("composer alignment", () => {
  it("bottom-aligns the primary controls beside a growing input", () => {
    expect(SOURCE).toContain('className="flex items-end gap-2"');
    expect(SOURCE).not.toContain('className="flex items-stretch gap-2"');
    expect(SOURCE).toContain("block w-full px-3 py-2");
  });

  it("keeps the expanded rich composer four lines tall", () => {
    expect(SOURCE).toContain("rows={4}");
    expect(SOURCE).not.toContain('textareaClassName="min-h-10');
  });

  it("gives the chat message field a stable accessible name", () => {
    expect(SOURCE).toContain(': "Message"');
    expect(SOURCE).toContain('textareaAriaLabel="Message"');
  });

  it("anchors the compose menu to the logical start edge for RTL", () => {
    expect(SOURCE).toContain(
      'className="absolute bottom-full start-0 z-30 mb-2 grid min-w-52',
    );
    expect(SOURCE).not.toContain(
      'className="absolute bottom-full left-0 z-30 mb-2 grid',
    );
  });

  it("places manual conversation compaction in the compose menu", () => {
    expect(SOURCE).toContain("Compact conversation");
    expect(SOURCE).toContain("onCompactConversation");
    expect(SOURCE).toContain("canCompactConversation");
  });

  it("does not duplicate terminal status beneath the composer input", () => {
    expect(SOURCE).not.toContain("terminalProblemMessage");
    expect(HOST_SOURCE).not.toContain("terminalProblemMessage");
  });
});
