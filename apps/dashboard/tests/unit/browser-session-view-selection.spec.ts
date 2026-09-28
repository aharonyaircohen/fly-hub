import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(
  new URL(
    "../../src/dashboard/lib/previews/use-browser-session.ts",
    import.meta.url,
  ),
);
const surfaceSourcePath = fileURLToPath(
  new URL(
    "../../src/dashboard/features/previews/components/FlyRemoteBrowserSurface.tsx",
    import.meta.url,
  ),
);

describe("browser session View selection lifecycle", () => {
  it("keeps an active Fly session while the selected View URL changes", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("const initialUrlRef = useRef(input.initialUrl)");
    expect(source).toContain("const initialUrl = initialUrlRef.current");
    expect(source).toContain("[input.actorLogin, input.enabled]");
    expect(source).toContain('modeRef.current.kind === "remote" ||');
  });

  it("connects when the initial View arrives after configuration loads", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("[connect, input.initialUrl]");
    expect(source).toContain("void connect(false)");
  });

  it("aligns a resumed browser with the currently selected View", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("status.currentUrl !== initialUrl");
    expect(source).toContain('{ type: "navigate", url: desiredUrl }');
    expect(source).toContain("initialUrlRef.current !== desiredUrl");
  });

  it("resumes an existing repository browser without starting it again", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("await fetchBrowserSession(input.actorLogin)");
    expect(source).toContain('status.state === "idle"');
    expect(source).toContain('status.state === "failed"');
  });

  it("treats provider-free iframe mode as a terminal fallback", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain('if (status.mode === "iframe")');
    expect(source).toContain(
      'setMode({ kind: "iframe", reason: status.reason })',
    );
    expect(source).not.toContain(
      'mode.kind !== "iframe" && mode.kind !== "error"',
    );
  });

  it("keeps the latest selected URL during an in-flight connection", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("const generation = ++generationRef.current");
    expect(source).toContain(
      "if (generation !== generationRef.current) return",
    );
    expect(source).toContain("const desiredUrl = initialUrlRef.current");
    expect(source).toContain("initialUrlRef.current !== desiredUrl");
    expect(source).toContain("currentUrl: navigation.url ?? desiredUrl");
  });

  it("does not restart the whole browser after a session recovery failure", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toContain("recoveryAttemptsRef");
    expect(source).toContain("autoRecoveryBlockedRef");
    expect(source).toContain("if (autoRecoveryBlockedRef.current) return");
  });

  it("allows only one browser connection attempt at a time", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("const connectingRef = useRef(false)");
    expect(source).toContain("if (connectingRef.current) return");
    expect(source).toContain("connectingRef.current = true");
    expect(source).toContain("connectingRef.current = false");
  });

  it("waits for another starter instead of creating a second Machine", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain('error.message !== "browser_start_in_progress"');
    expect(source).toContain("window.setTimeout(resolve, 1_000)");
  });

  it("renews browser access before expiry and after the page becomes visible", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("resumeBrowserSession(");
    expect(source).toContain("ticketExpiresAt * 1_000");
    expect(source).toContain('document.visibilityState === "visible"');
    expect(source).toContain("autoRecoveryBlockedRef");
  });

  it("hands terminal stream failure to one bounded session recovery", () => {
    const source = readFileSync(surfaceSourcePath, "utf8");
    const closeHandler = source.slice(
      source.indexOf('websocket.addEventListener("close"'),
      source.indexOf('websocket.addEventListener("error"'),
    );

    expect(closeHandler).toContain("reconnectAttempts < 3");
    expect(closeHandler).toContain("onConnectionLost");
    expect(source).toContain("onClick={callbacksRef.current.onReconnect}");
  });
});
