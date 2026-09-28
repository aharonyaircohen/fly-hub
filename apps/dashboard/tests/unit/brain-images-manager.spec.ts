/**
 * @fileoverview Source-level guard for Brain Images manager mutation refreshes.
 * @testFramework vitest
 * @domain brain
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/features/admin/components/BrainImagesManager.tsx",
  ),
  "utf8",
);

describe("BrainImagesManager", () => {
  it("reloads authoritative image state after each mutating action", () => {
    expect(SOURCE).toContain("await loadImages();");
    expect(SOURCE).toContain('toast.success("Brain image applied");');
    expect(SOURCE).toContain(
      'await loadImages();\n      toast.success("Brain image deleted");',
    );
  });

  it("reloads authoritative state when the page returns to the foreground", () => {
    expect(SOURCE).toContain(
      'window.addEventListener("focus", refreshOnFocus)',
    );
    expect(SOURCE).toContain(
      'window.removeEventListener("focus", refreshOnFocus)',
    );
    expect(SOURCE).toContain('document.visibilityState === "visible"');
  });

  it("requires confirmation before permanently deleting an image", () => {
    expect(SOURCE).toContain(
      'import { ConfirmDialog } from "@dashboard/lib/components/ConfirmDialog";',
    );
    expect(SOURCE).toContain("const [pendingDeleteRef, setPendingDeleteRef]");
    expect(SOURCE).toContain(
      "onClick={() => setPendingDeleteRef(image.imageRef)}",
    );
    expect(SOURCE).toContain("<ConfirmDialog");
    expect(SOURCE).toContain('confirmLabel="Delete image"');
    expect(SOURCE).toContain('variant="destructive"');
    expect(SOURCE).toContain(
      "if (pendingDeleteRef) void deleteImage(pendingDeleteRef);",
    );
    expect(SOURCE).toContain(': "Delete image"');
    expect(SOURCE).toContain('aria-label="Delete image"');
    expect(SOURCE).toContain("Permanently delete this Brain image?");
    expect(SOURCE).toContain("This permanently removes the GHCR package image");
    expect(SOURCE).toContain("disabled={busy || running || applyBusy}");
    expect(SOURCE).not.toContain("Forget image");
    expect(SOURCE).not.toContain("forgotten");
  });

  it("requires confirmation before running or rerunning a Brain image", () => {
    expect(SOURCE).toContain("const [pendingApplyRef, setPendingApplyRef]");
    expect(SOURCE).toContain("requestApplyImage(image.imageRef)");
    expect(SOURCE).toContain("This will replace the Brain machine image");
    expect(SOURCE).toContain("This will rerun the active Brain image");
    expect(SOURCE).toContain(
      "Unsaved changes in the current machine may be lost",
    );
    expect(SOURCE).toContain(
      'confirmLabel={pendingApplyIsRunning ? "Rerun image" : "Run image"}',
    );
    expect(SOURCE).toContain("void applyImage(");
    expect(SOURCE).toContain("pendingApplyIsRunning");
    expect(SOURCE).toContain(
      "function requestApplyImage(imageRef: string) {\n    setPendingApplyRef(imageRef);\n  }",
    );
    expect(SOURCE).not.toContain("void applyImage(imageRef);");
  });

  it("refreshes terminal machine targets after applying an image", () => {
    expect(SOURCE).toContain(
      'window.dispatchEvent(new Event("kody:fly-machines-refresh"));',
    );
    expect(SOURCE).toContain('"kody:brain-runtime-change"');
    expect(SOURCE).toContain('detail: { phase: "start", imageRef }');
    expect(SOURCE).toContain(
      'detail: { phase: "complete", imageRef: operation.imageRef }',
    );
    expect(SOURCE).toContain("Restoring Brain image");
    expect(SOURCE).toMatch(/The terminal will\s+reconnect/);
  });

  it("shows the durable restore stage and retry attempt", () => {
    expect(SOURCE).toContain("restoreStageMessage(operation.stage, operation.attempt)");
    expect(SOURCE).toContain('"installing-agent-access": "Installing secure agent access"');
    expect(SOURCE).toContain('"verifying-health": "Verifying Brain health"');
    expect(SOURCE).toContain('`${message} (attempt ${attempt})`');
    expect(SOURCE).toContain("applyState.message");
  });

  it("runs the clicked image as the only image activation action", () => {
    expect(SOURCE).toContain("body: JSON.stringify({ imageRef, reset }),");
    expect(SOURCE).toContain(
      'headers: { "content-type": "application/json", ...headers },',
    );
    expect(SOURCE).toContain(
      'running ? "Rerun Brain image" : "Run Brain image"',
    );
    expect(SOURCE).toContain(
      'title={running ? "Rerun Brain image" : "Run Brain image"}',
    );
    expect(SOURCE).toContain("<RotateCcw");
    expect(SOURCE).not.toContain("<Square");
    expect(SOURCE).toContain('size="icon"');
    expect(SOURCE).toContain("disabled={busy || applyBusy}");
    expect(SOURCE).not.toContain("disabled={running || busy}");
    expect(SOURCE).not.toContain(
      '{running ? "Running Brain image" : "Run this image"}',
    );
    expect(SOURCE).not.toContain("selectImage(");
    expect(SOURCE).not.toContain('toast.success("Brain image selected")');
    expect(SOURCE).not.toContain('method: "PATCH"');
    expect(SOURCE).not.toContain("disabled={!selected || running || busy}");
  });

  it("uses running as the only active state on each image row", () => {
    expect(SOURCE).toContain('aria-label="Running Brain image"');
    expect(SOURCE).toMatch(/>\s+Running\s+<\/span>/);
    expect(SOURCE).toContain("<CheckCircle2");
    expect(SOURCE).toContain("text-emerald-300");
    expect(SOURCE).toContain("bg-emerald-400/10");
    expect(SOURCE).not.toContain('aria-label="Selected Brain image"');
    expect(SOURCE).not.toContain("activeImageRef");
  });

  it("shows running Brain image, latest save, and saved image count separately", () => {
    expect(SOURCE).toContain(
      "Run this image replaces the saved Brain machine image",
    );
    expect(SOURCE).toContain("Running Brain image");
    expect(SOURCE).toContain("Latest save");
    expect(SOURCE).toContain("Saved images");
    expect(SOURCE).not.toContain("Selected Brain image");
    expect(SOURCE).not.toContain("Pending image");
    expect(SOURCE).toContain('Machine {machineState ?? "state unknown"}');
    expect(SOURCE).toContain("machineImageRef");
    expect(SOURCE).toContain("Saved {formatDate(image.updatedAt)}");
    expect(SOURCE).toContain("`Applied ${formatDate(runningAt)}`");
  });

  it("shows running save elapsed time against now instead of last update", () => {
    expect(SOURCE).toContain("elapsedLabel(save.startedAt)");
    expect(SOURCE).not.toContain(
      "elapsedLabel(save.startedAt, save.updatedAt)",
    );
  });

  it("shows live save heartbeat separately from elapsed time", () => {
    expect(SOURCE).toContain("function liveSignalLabel");
    expect(SOURCE).toContain("heartbeatAt: body.heartbeatAt");
    expect(SOURCE).toContain("liveSignalLabel(save.heartbeatAt)");
  });

  it("bounds save polling and reloads authoritative state after a dropped poll", () => {
    expect(SOURCE).toContain("signal: AbortSignal.timeout(30_000)");
    expect(SOURCE).toContain("setError(message);");
    expect(SOURCE).toContain("await loadImages();");
  });
});
