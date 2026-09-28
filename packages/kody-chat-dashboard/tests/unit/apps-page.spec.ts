import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Apps page", () => {
  const source = readFileSync(
    new URL(
      "../../src/dashboard/lib/components/AppsManager.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  it("uses the approved master-detail layout and one set of management sections", () => {
    expect(source).toContain("MasterDetailShell");
    for (const section of ["Overview", "Activity", "Access", "Settings"]) {
      expect(source).toContain(section);
    }
  });

  it("keeps provider infrastructure out of App settings", () => {
    expect(source).not.toContain("function Domains(");
    expect(source).not.toContain("function Storage(");
    expect(source).not.toContain("Create storage");
    expect(source).toContain('scopedHref("/fly/volumes")');
  });

  it("links repository secrets to their existing management page", () => {
    expect(source).toContain('scopedHref("/secrets")');
    expect(source).toContain("Manage repository secrets");
  });

  it("deploys repository software without presenting existing system apps as choices", () => {
    expect(source).toContain('aria-label="App name"');
    expect(source).toContain("Deploy app");
    expect(source).toContain("Deploy repository app");
    expect(source).not.toContain("Choose what to add");
    expect(source).not.toContain("Browser is already available");
    expect(source).not.toContain("Brain is already available");
    expect(source).toContain("window.History.prototype.pushState");
    expect(source).not.toContain("kody:pending-chat-prefill");
  });

  it("explains the optional repository folder without exposing dot notation", () => {
    expect(source).toContain("Folder containing the app (optional)");
    expect(source).toContain(
      "Leave empty if the app uses the whole repository",
    );
    expect(source).toContain('placeholder="apps/web"');
    expect(source).toContain('rootDirectory.trim() || "."');
  });

  it("loads once and leaves later synchronization to the explicit refresh action", () => {
    expect(source).not.toContain("window.setInterval");
    expect(source).toContain("useQuery");
    expect(source).toContain("staleTime: Infinity");
    expect(source).toContain("sessionStorage");
  });

  it("offers explicit refresh and Fly machine management", () => {
    expect(source).toContain('aria-label="Refresh apps"');
    expect(source).toContain("View machines");
    expect(source).toContain(
      "scopedHref(`/fly/machines/${app.provider.appName}`)",
    );
  });

  it("shows the external source repository owned by the App", () => {
    expect(source).toContain("app.repository");
  });

  it("shows explicit lifecycle progress and one clear primary action", () => {
    expect(source).toContain("Starting app…");
    expect(source).toContain('aria-label="Open app"');
    expect(source).toContain("Start app");
    expect(source).toContain("Stop app");
    expect(source).toContain("Restart app");
  });

  it("waits for repository authentication before loading Apps", () => {
    expect(source).toContain("enabled: !authLoading && Boolean(auth)");
  });

  it("publishes only safe selected-App context to Chat", () => {
    expect(source).toContain('"kody:set-chat-scope"');
    expect(source).toMatch(/kind:\s*"app"/);
    expect(source).not.toContain("tokenHash");
  });

  it("keeps routine lifecycle controls in one actions menu", () => {
    expect(source).toContain('aria-label="App actions"');
  });
});
