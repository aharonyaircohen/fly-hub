import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  TerminalBottomControls,
  TerminalModeToggle,
  TerminalTopControls,
} from "../../src/dashboard/lib/chat/plugins/terminal/TerminalControls";

const CONTROLS_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/lib/chat/plugins/terminal/TerminalControls.tsx",
  ),
  "utf8",
);
const HOST_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/lib/components/kody-chat-terminal-host.tsx",
  ),
  "utf8",
);

describe("terminal controls in the composer menu", () => {
  it("shows Brain save progress on its own line below the terminal header", () => {
    const markup = renderToStaticMarkup(
      createElement(TerminalTopControls, {
        activeTargetValue: "brain",
        onSelectTarget: () => undefined,
        activeTransport: { type: "brain" },
        terminalMachines: [],
        flyInventoryError: null,
        flyInventoryLoading: false,
        onRefreshMachines: () => undefined,
        brainImageBusy: true,
        brainImageSaveLabel: "Pushing the Brain image to GHCR",
        onSaveBrainImage: () => undefined,
      }),
    );

    const headerIndex = markup.indexOf(
      'data-testid="chat-terminal-actions-row"',
    );
    const statusIndex = markup.indexOf('data-testid="brain-image-save-status"');
    expect(headerIndex).toBeGreaterThan(-1);
    expect(statusIndex).toBeGreaterThan(headerIndex);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("basis-full");
    expect(markup).not.toContain("hidden max-w-40");
  });

  it("does not reserve an empty status line when Brain is not saving", () => {
    const markup = renderToStaticMarkup(
      createElement(TerminalTopControls, {
        activeTargetValue: "brain",
        onSelectTarget: () => undefined,
        activeTransport: { type: "brain" },
        terminalMachines: [],
        flyInventoryError: null,
        flyInventoryLoading: false,
        onRefreshMachines: () => undefined,
        brainImageBusy: false,
        brainImageSaveLabel: "Save Brain image",
        onSaveBrainImage: () => undefined,
      }),
    );

    expect(markup).not.toContain('data-testid="brain-image-save-status"');
  });

  it("keeps terminal actions in the same full-width menu-row layout", () => {
    expect(HOST_SOURCE).toContain('layout="menu"');
    expect(CONTROLS_SOURCE).toContain('layout?: "row" | "menu"');

    const markup = renderToStaticMarkup(
      createElement(TerminalBottomControls, {
        onAddToChat: () => undefined,
        onRestart: () => undefined,
        onClear: () => undefined,
        actionBusy: false,
        layout: "menu",
      }),
    );

    expect(markup).toContain("Add to AI chat");
    expect(markup).toContain("Restart terminal");
    expect(markup).toContain("Clear terminal");
    expect(markup.match(/w-full/g)).toHaveLength(3);
  });

  it("keeps the mode-toggle container unchanged when the selected mode changes", () => {
    const renderToggle = (chatMode: "ai" | "terminal") =>
      renderToStaticMarkup(
        createElement(TerminalModeToggle, {
          chatMode,
          terminalStatusLabel: "idle",
          hasLiveTerminal: false,
          connectionState: "idle",
          onSelectAiMode: () => undefined,
          onOpenTerminal: () => undefined,
        }),
      );

    const outerClass = (markup: string) =>
      markup.match(/^<div class="([^"]+)"/)?.[1];

    expect(outerClass(renderToggle("ai"))).toBe(
      outerClass(renderToggle("terminal")),
    );
  });

  it("disables restart until a terminal is connected", () => {
    const markup = renderToStaticMarkup(
      createElement(TerminalBottomControls, {
        onAddToChat: () => undefined,
        onRestart: () => undefined,
        onClear: () => undefined,
        actionBusy: false,
        restartDisabled: true,
      }),
    );

    expect(markup).toContain('aria-label="Restart terminal"');
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Restart terminal"/);
  });

  it("invalidates the Brain terminal when an image restore changes the runtime", () => {
    expect(HOST_SOURCE).toContain('"kody:brain-runtime-change"');
    expect(HOST_SOURCE).toContain("terminal.prepareForRuntimeChange()");
    expect(HOST_SOURCE).toContain("void terminal.reconnectFresh()");
    expect(HOST_SOURCE).toContain('phase === "complete"');
  });
});
