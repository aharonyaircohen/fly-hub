/**
 * @fileType module
 * @domain chat-plugin-terminal
 * @pattern xterm-bootstrap
 * @ai-summary xterm bootstrap for the chat terminal surface: lazy-loads
 *   @xterm modules, builds the terminal with the Kody theme, wires the
 *   fit/web-links addons and the data/selection/resize listeners. Extracted
 *   from ChatTerminalSurface in
 *   Step 5a (800-line rule); behavior unchanged.
 */
import type { FitAddon as XTermFitAddon } from "@xterm/addon-fit";
import type { Terminal as XTerm } from "@xterm/xterm";

import { openTerminalWebLink } from "./terminal-text";

export interface TerminalMountHandlers {
  onData: (data: string) => void;
  onSelectionChange: (selection: string) => void;
  onResize: (cols: number, rows: number) => void;
  isActive: () => boolean;
}

export interface MountedXterm {
  terminal: XTerm;
  fitAddon: XTermFitAddon;
  observer: ResizeObserver;
  disposables: Array<{ dispose: () => void }>;
}

type RestartableXterm = Pick<XTerm, "focus"> & {
  write(data: string): void;
};

// Leave the alternate screen and disable input modes commonly enabled by
// full-screen programs. Unlike Terminal.reset()/clear(), this preserves the
// normal buffer so users can still scroll through output after a restart.
const RESTART_MODE_RESET =
  "\u001b[?1049l\u001b[?2004l\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1006l\u001b[0m\r\n";

/** Restore interactive terminal modes before starting a fresh PTY session. */
export function resetTerminalUiForRestart(terminal: RestartableXterm): void {
  terminal.write(RESTART_MODE_RESET);
  terminal.focus();
}

/**
 * Load and mount xterm into `host`. Returns null when `isDisposed()` flips
 * before the lazy imports resolve (the caller unmounted mid-load).
 */
export async function mountChatTerminal(
  host: HTMLElement,
  handlers: TerminalMountHandlers,
  isDisposed: () => boolean,
): Promise<MountedXterm | null> {
  const [{ Terminal }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
    import("@xterm/xterm"),
    import("@xterm/addon-fit"),
    import("@xterm/addon-web-links"),
  ]);
  if (isDisposed()) return null;

  const terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    fontFamily:
      "'SFMono-Regular', 'Cascadia Code', 'Liberation Mono', Menlo, monospace",
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 10000,
    theme: {
      background: "#050608",
      foreground: "#d7dde8",
      cursor: "#ffffff",
      black: "#0a0d12",
      blue: "#7aa2f7",
      cyan: "#7dcfff",
      green: "#9ece6a",
      magenta: "#bb9af7",
      red: "#f7768e",
      white: "#c0caf5",
      yellow: "#e0af68",
    },
  });
  const fitAddon = new FitAddon();
  const webLinksAddon = new WebLinksAddon((_event, uri) => {
    openTerminalWebLink(uri);
  });
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(webLinksAddon);
  terminal.open(host);
  fitAddon.fit();

  const disposables: Array<{ dispose: () => void }> = [];
  disposables.push(terminal.onData(handlers.onData));
  disposables.push(
    terminal.onSelectionChange(() => {
      handlers.onSelectionChange(terminal.getSelection());
    }),
  );
  disposables.push(
    terminal.onResize(({ cols, rows }) => handlers.onResize(cols, rows)),
  );

  const observer = new ResizeObserver(() => {
    requestAnimationFrame(() => {
      if (!handlers.isActive()) return;
      fitAddon.fit();
      handlers.onResize(terminal.cols, terminal.rows);
    });
  });
  observer.observe(host);

  return { terminal, fitAddon, observer, disposables };
}
