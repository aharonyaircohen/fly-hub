/**
 * @fileoverview Contract tests for the chat-side /terminal directive.
 * @testFramework vitest
 * @domain terminal
 */
import { describe, expect, it } from "vitest";

import {
  buildKodyTerminalPrompt,
  extractKodyTerminalPayload,
  parseKodyTerminalIntent,
} from "@kody-ade/terminal/kody-terminal-directive";

describe("parseKodyTerminalIntent", () => {
  it("extracts the user intent from a /terminal chat command", () => {
    expect(parseKodyTerminalIntent("/terminal create script x")).toEqual({
      intent: "create script x",
    });
  });

  it("supports multiline intent text", () => {
    expect(
      parseKodyTerminalIntent("/terminal\ncreate script x\nwith two lines"),
    ).toEqual({
      intent: "create script x\nwith two lines",
    });
  });

  it("ignores non-terminal input and empty terminal commands", () => {
    expect(
      parseKodyTerminalIntent("hello /terminal create script x"),
    ).toBeNull();
    expect(parseKodyTerminalIntent("/terminal")).toBeNull();
    expect(parseKodyTerminalIntent("/terminal   ")).toBeNull();
  });
});

describe("buildKodyTerminalPrompt", () => {
  it("asks Kody for exactly one terminal code block with no surrounding prose", () => {
    const prompt = buildKodyTerminalPrompt("create script x");

    expect(prompt).toContain("exactly one fenced code block labeled terminal");
    expect(prompt).toContain("Do not include prose before or after the block");
    expect(prompt).toContain("multiline");
    expect(prompt).toContain("create script x");
  });
});

describe("extractKodyTerminalPayload", () => {
  it("extracts one terminal block and preserves internal multiline content", () => {
    const payload = extractKodyTerminalPayload(
      "```terminal\ncat > script.sh <<'EOF'\necho hi\nEOF\nbash script.sh\n```",
    );

    expect(payload).toBe(
      "cat > script.sh <<'EOF'\necho hi\nEOF\nbash script.sh",
    );
  });

  it("returns null when Kody does not provide exactly one terminal block", () => {
    expect(extractKodyTerminalPayload("echo hi")).toBeNull();
    expect(
      extractKodyTerminalPayload(
        "```terminal\necho one\n```\n```terminal\necho two\n```",
      ),
    ).toBeNull();
  });
});
