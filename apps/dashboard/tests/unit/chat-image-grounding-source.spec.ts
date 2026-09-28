/**
 * Source-level guards for image-grounded chat turns.
 *
 * @testFramework vitest
 * @domain chat-contract
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The send pipeline (sendText) moved from KodyChat.tsx to
// kody-chat-send.ts in the phase-1.6b extraction — the guarded code
// lives there now; assertions are unchanged.
const KODY_CHAT_SOURCE = readFileSync(
  resolve(__dirname, "../../node_modules/@kody-ade/kody-chat-dashboard/src/dashboard/lib/components/kody-chat-send.ts"),
  "utf8",
);
const HERMES_RUNTIME_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/hermes/runtime.ts"),
  "utf8",
);

describe("image-grounded chat turns", () => {
  it("sends image bytes through the Hermes bridge", () => {
    expect(KODY_CHAT_SOURCE).toContain('attachment.mimeType.startsWith("image/")');
    expect(KODY_CHAT_SOURCE).toContain("images.push({ name: attachment.name, dataUrl: attachment.data })");
    expect(HERMES_RUNTIME_SOURCE).toContain('rpc("image.attach_bytes"');
  });

  it("stages images before submitting the Hermes prompt", () => {
    expect(HERMES_RUNTIME_SOURCE.indexOf('rpc("image.attach_bytes"')).toBeLessThan(
      HERMES_RUNTIME_SOURCE.indexOf('rpc("prompt.submit"'),
    );
  });
});
