/**
 * @testFramework vitest
 * @domain preview
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PREVIEW_BROWSER_PATH = resolve(
  __dirname,
  "../../src/dashboard/features/previews/components/PreviewBrowser.tsx",
);
const REMOTE_SURFACE_PATH = resolve(
  __dirname,
  "../../src/dashboard/features/previews/components/FlyRemoteBrowserSurface.tsx",
);
const BROWSER_START_PATH = resolve(
  __dirname,
  "../../../../packages/fly/browser/start.sh",
);
const BROWSER_SERVER_PATH = resolve(
  __dirname,
  "../../../../packages/fly/browser/server.ts",
);
const PREVIEW_WORKSPACE_PATH = resolve(
  __dirname,
  "../../src/dashboard/features/previews/components/PreviewWorkspace.tsx",
);
const PREVIEW_ENV_SWITCHER_PATH = resolve(
  __dirname,
  "../../src/dashboard/features/previews/components/PreviewEnvSwitcher.tsx",
);
const FLY_MACHINES_TABLE_PATH = resolve(
  __dirname,
  "../../src/dashboard/features/previews/components/FlyMachinesTable.tsx",
);

const SOURCE = readFileSync(PREVIEW_BROWSER_PATH, "utf8");
const REMOTE_SURFACE_SOURCE = readFileSync(REMOTE_SURFACE_PATH, "utf8");
const BROWSER_START_SOURCE = readFileSync(BROWSER_START_PATH, "utf8");
const BROWSER_SERVER_SOURCE = readFileSync(BROWSER_SERVER_PATH, "utf8");
const REMOTE_PICKER_SOURCE = readFileSync(
  resolve(
    __dirname,
    "../../src/dashboard/lib/picker/useRemoteElementPicker.ts",
  ),
  "utf8",
);
const PREVIEW_WORKSPACE_SOURCE = readFileSync(PREVIEW_WORKSPACE_PATH, "utf8");
const PREVIEW_ENV_SWITCHER_SOURCE = readFileSync(
  PREVIEW_ENV_SWITCHER_PATH,
  "utf8",
);
const FLY_MACHINES_TABLE_SOURCE = readFileSync(FLY_MACHINES_TABLE_PATH, "utf8");
const BROWSER_SESSION_HOOK_SOURCE = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/previews/use-browser-session.ts"),
  "utf8",
);

describe("PreviewBrowser new-tab action", () => {
  it("renders an external-link icon that opens the iframe-ready preview URL", () => {
    expect(SOURCE).toMatch(/ExternalLink,?[\s\S]*from "lucide-react"/);
    expect(SOURCE).toMatch(
      /href=\{externalPreviewUrl\s*\?\?\s*activePreviewUrl\}[\s\S]*target="_blank"[\s\S]*rel="noopener noreferrer"[\s\S]*aria-label="Open preview in a new tab"[\s\S]*<ExternalLink/,
    );
  });

  it("does not push auth-only URL changes into preview history", () => {
    expect(SOURCE).toMatch(
      /function sameBrowserAddress[\s\S]*stripPreviewAuthParams\(left,[\s\S]*stripPreviewAuthParams\(right,/,
    );
  });

  it("keeps observed iframe URLs from remounting the iframe", () => {
    expect(SOURCE).toMatch(
      /const \[iframeSourceUrl,\s*setIframeSourceUrl\] = useState/,
    );
    expect(SOURCE).toMatch(
      /const iframeLoadUrl = iframeSourceUrl \?\? previewUrl/,
    );
    expect(SOURCE).toMatch(/src=\{iframeBypassedUrl \?\? undefined\}/);

    const syncBlock = SOURCE.match(
      /const syncBrowserHistoryUrl = useCallback\([\s\S]*?\n  \);/,
    );
    expect(syncBlock).not.toBeNull();
    expect(syncBlock![0]).toContain("setBrowserHistory");
    expect(syncBlock![0]).not.toContain("setIframeSourceUrl");
  });

  it("only explicit browser commands update the iframe load source", () => {
    expect(SOURCE).toContain("setIframeSourceUrl(nextUrl)");
    expect(SOURCE).toContain("setIframeSourceUrl(authedNextUrl)");
    expect(SOURCE).toContain("setIframeSourceUrl(nextRefreshSourceUrl)");
  });

  it("keeps one browser shell and routes its existing controls to Fly", () => {
    expect(SOURCE).toContain("useBrowserSession");
    expect(SOURCE).toContain(
      "remoteAct={remoteSession ? remoteBrowserAct : undefined}",
    );
    expect(SOURCE).toMatch(
      /if \(remoteSession\)[\s\S]*type: "navigate", url: nextUrl/,
    );
    expect(SOURCE).toMatch(/if \(remoteSession\)[\s\S]*type: "navigate"/);
    expect(SOURCE).toMatch(/if \(remoteSession\)[\s\S]*type: "reload"/);
    expect(SOURCE).toContain("<FlyRemoteBrowserSurface");
  });

  it("uses Chromium as the source for remote Back and Forward", () => {
    expect(SOURCE).toMatch(
      /if \(remoteSession\)[\s\S]*remoteBrowserAct\(\{ type: direction \}\)/,
    );
    expect(SOURCE).toContain("remotePage?.canGoBack");
    expect(SOURCE).toContain("remotePage?.canGoForward");
  });

  it("uses stream events for the Fly URL without snapshot polling", () => {
    expect(SOURCE).toContain("onPageState={handleRemotePageState}");
    expect(SOURCE).toContain("remotePage?.url");
    expect(SOURCE).not.toMatch(/setInterval\(syncRemotePage/);
    expect(PREVIEW_ENV_SWITCHER_SOURCE).toMatch(
      /const active = selectedId[\s\S]*: null/,
    );
  });

  it("creates a distinct saved environment name when the derived name exists", () => {
    expect(PREVIEW_WORKSPACE_SOURCE).toContain(
      "function uniqueEnvironmentLabel",
    );
    expect(PREVIEW_WORKSPACE_SOURCE).toContain("const usedLabels = new Set(");
    expect(PREVIEW_WORKSPACE_SOURCE).toContain(
      "usedLabels.has(label.trim().toLowerCase())",
    );
    expect(PREVIEW_WORKSPACE_SOURCE).toMatch(
      /const label = uniqueEnvironmentLabel\([\s\S]*addEnvironment\([\s\S]*label,[\s\S]*normalizedUrl/,
    );
  });

  it("hydrates the saved bookmark before choosing a fallback", () => {
    expect(PREVIEW_WORKSPACE_SOURCE).toMatch(
      /const \[loadedSelectionScope, setLoadedSelectionScope\] = useState<[\s\S]*?null>\(null\);/,
    );
    expect(PREVIEW_WORKSPACE_SOURCE).toMatch(
      /if \(loadedSelectionScope !== selectionScope\) return;/,
    );
    expect(PREVIEW_WORKSPACE_SOURCE).toContain(
      "setLoadedSelectionScope(selectionScope);",
    );
  });

  it("shows browser Machines while preserving the stable repository app", () => {
    expect(FLY_MACHINES_TABLE_SOURCE).toMatch(
      /const FEATURE_ORDER[\s\S]*"browser"/,
    );
    expect(FLY_MACHINES_TABLE_SOURCE).toContain(
      'return feature === "preview" || feature === "preview-base";',
    );
    expect(FLY_MACHINES_TABLE_SOURCE).toContain(
      "The stable repository browser app remains available",
    );
  });

  it("reuses the stable Fly browser session when the stream reconnects", () => {
    expect(BROWSER_SESSION_HOOK_SOURCE).toMatch(
      /const connect = useCallback\(\s*async \(forceStart = false\) =>/,
    );
    expect(BROWSER_SESSION_HOOK_SOURCE).toContain(
      "await fetchBrowserSession(input.actorLogin)",
    );
    expect(BROWSER_SESSION_HOOK_SOURCE).toContain("await startBrowserSession(");
    expect(BROWSER_SESSION_HOOK_SOURCE).toContain(
      "const session = await resumeBrowserSession(",
    );
    expect(BROWSER_SESSION_HOOK_SOURCE).toContain(
      "const reconnect = useCallback(() =>",
    );
  });

  it("retains the iframe renderer as the provider-free fallback", () => {
    expect(SOURCE).toMatch(
      /remoteBrowserMode\.kind === "error"[\s\S]*: activePreviewUrl \? \([\s\S]*<PreviewIframe/,
    );
    expect(SOURCE).toMatch(
      /\{remoteSession && \([\s\S]*aria-label="Open direct login"/,
    );
  });

  it("retries transient page-stream disconnects with a bounded backoff", () => {
    expect(REMOTE_SURFACE_SOURCE).toContain("reconnectAttempts < 3");
    expect(REMOTE_SURFACE_SOURCE).toMatch(
      /const connect = \(\): void =>[\s\S]*new WebSocket\(streamUrl\)[\s\S]*setTimeout/,
    );
    expect(REMOTE_SURFACE_SOURCE).toContain("setDisconnected(true)");
    expect(REMOTE_SURFACE_SOURCE).toContain("onDisconnected?: () => void");
    expect(REMOTE_SURFACE_SOURCE).toContain(
      "callbacksRef.current.onDisconnected?.()",
    );
    expect(REMOTE_SURFACE_SOURCE).toContain("if (disposed) return");
  });

  it("keeps the sharp webpage stream separate from direct desktop login", () => {
    expect(BROWSER_START_SOURCE).not.toContain("--headless=new");
    expect(BROWSER_START_SOURCE).toContain("--window-size=1440,900");
    expect(BROWSER_START_SOURCE).toMatch(/Xvfb|fluxbox|x11vnc/);
    expect(BROWSER_SERVER_SOURCE).toContain("Page.startScreencast");
    expect(BROWSER_SERVER_SOURCE).toContain('"/direct-stream"');
    expect(REMOTE_SURFACE_SOURCE).toContain("<canvas");
    expect(REMOTE_SURFACE_SOURCE).not.toContain("@novnc/novnc");
  });

  it("fits the remote desktop to the available desktop panel", () => {
    expect(REMOTE_SURFACE_SOURCE).toContain("new ResizeObserver");
    expect(REMOTE_SURFACE_SOURCE).toContain("onViewportResize(width, height)");
    expect(SOURCE).toContain('previewDevice !== "desktop"');
    expect(SOURCE).toContain("resizeRemoteDesktop");
    expect(SOURCE).toContain("onViewportResize={");
    expect(BROWSER_SERVER_SOURCE).toContain("async function resizePage");
    expect(BROWSER_SERVER_SOURCE).toContain("setViewportSize");
    expect(BROWSER_SERVER_SOURCE).not.toContain("xrandr");
    expect(BROWSER_SERVER_SOURCE).toMatch(
      /Math\.max\(320, Math\.min\(1920,[\s\S]*Math\.max\(480, Math\.min\(1800,/,
    );
  });

  it("arms the remote picker without holding one request open", () => {
    expect(BROWSER_SERVER_SOURCE).toContain(
      'content: "globalThis.__name = (target) => target;"',
    );
    expect(BROWSER_SERVER_SOURCE).toContain('case "pickResult"');
    expect(BROWSER_SERVER_SOURCE).toContain(
      'document.documentElement.style.cursor = "crosshair"',
    );
    expect(BROWSER_SERVER_SOURCE).toContain(
      'target.style.outline = "2px solid #38bdf8"',
    );
    expect(REMOTE_PICKER_SOURCE).toContain('remoteAct({ type: "pickResult" })');
    expect(REMOTE_PICKER_SOURCE).toContain("pickGenerationRef.current += 1");
  });
});
