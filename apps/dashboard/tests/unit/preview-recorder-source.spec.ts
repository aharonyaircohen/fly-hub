/**
 * Source-level guards for the extension macro recorder.
 *
 * @testFramework vitest
 * @domain preview-inspector
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CONTENT_SOURCE = readFileSync(
  resolve(__dirname, "../../extension/src/content.js"),
  "utf8",
);
const COLLECTOR_SOURCE = readFileSync(
  resolve(__dirname, "../../extension/src/collector.js"),
  "utf8",
);
const CHROME_MANIFEST = JSON.parse(
  readFileSync(resolve(__dirname, "../../extension/manifest.json"), "utf8"),
);
const FIREFOX_MANIFEST = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../extension/manifest.firefox.json"),
    "utf8",
  ),
);
const PICKER_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../../../packages/kody-chat-dashboard/src/dashboard/lib/picker/useElementPicker.ts",
  ),
  "utf8",
);

describe("extension macro recorder", () => {
  it("persists in-flight recordings across preview navigations", () => {
    expect(CONTENT_SOURCE).toContain("__kody_recording_state_v1");
    expect(CONTENT_SOURCE).toContain("sessionStorage.setItem");
    expect(CONTENT_SOURCE).toContain("restoreRecording();");
    expect(CONTENT_SOURCE).toContain("requestId: msg.requestId");
  });

  it("does not let the first empty iframe reply discard recorded steps", () => {
    expect(PICKER_SOURCE).toContain("pickRecordingResult");
    expect(PICKER_SOURCE).toContain("data.requestId !== requestId");
    expect(PICKER_SOURCE).toContain("settle(best)");
  });

  it("loads the collector as a main-world content script instead of inline injection", () => {
    expect(CONTENT_SOURCE).not.toContain('document.createElement("script")');
    expect(CONTENT_SOURCE).not.toContain("injectCollector");
    expect(COLLECTOR_SOURCE).toContain("kody-picker:collector");
    expect(CHROME_MANIFEST.content_scripts).toContainEqual(
      expect.objectContaining({
        world: "MAIN",
        js: ["src/collector.js"],
      }),
    );
    expect(FIREFOX_MANIFEST.content_scripts).toContainEqual(
      expect.objectContaining({
        world: "MAIN",
        js: ["src/collector.js"],
      }),
    );
  });
});
