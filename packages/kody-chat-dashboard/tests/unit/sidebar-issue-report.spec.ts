import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sidebarSource = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/Sidebar.tsx"),
  "utf8",
);
const composerSource = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/chat/surface/Composer.tsx"),
  "utf8",
);
const chatShellSource = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/ChatShell.tsx"),
  "utf8",
);
const repoSwitcherSource = readFileSync(
  resolve(__dirname, "../../src/dashboard/lib/components/RepoSwitcher.tsx"),
  "utf8",
);

describe("sidebar issue report action", () => {
  it("stacks the report action above a centered version", () => {
    expect(sidebarSource).toContain("onReportIssue?: () => void;");
    expect(sidebarSource).toContain("onClick={onReportIssue}");
    expect(sidebarSource).toContain('aria-label="Report issue to Kody"');
    expect(sidebarSource).toContain("text-destructive");
    expect(sidebarSource).toContain('Bug className="h-5 w-5 shrink-0"');
    expect(sidebarSource).toContain('data-sidebar-report-issue="true"');
    expect(sidebarSource).toContain('data-sidebar-version="true"');
    expect(sidebarSource.indexOf("{onReportIssue && (")).toBeLessThan(
      sidebarSource.indexOf("{APP_VERSION && ("),
    );
    expect(chatShellSource).toContain("onIssueReportReady={setIssueReporter}");
    expect(chatShellSource).toContain("onReportIssue={reportIssueAction}");
  });

  it("does not keep the action in the compose menu", () => {
    expect(composerSource).not.toContain("onReportIssue");
    expect(composerSource).not.toContain("Report issue");
  });
});

describe("collapsed sidebar controls", () => {
  it("opens search in a floating picker without expanding the rail", () => {
    const collapsedSearchSource = sidebarSource.slice(
      sidebarSource.indexOf("mode opens the same destinations"),
      sidebarSource.indexOf("{navigationExtra && ("),
    );

    expect(collapsedSearchSource).toContain("open={collapsedSearchOpen}");
    expect(collapsedSearchSource).toContain("Search navigation");
    expect(collapsedSearchSource).toContain("collapsedSearchItems.map");
    expect(collapsedSearchSource).not.toContain("onClick={toggleCollapsed}");
  });

  it("keeps the notifications slot visible while collapsed", () => {
    expect(sidebarSource).toContain("{brandRowExtra && isCollapsed && (");
    expect(sidebarSource).toContain(
      'data-sidebar-collapsed-notifications="true"',
    );
  });

  it("keeps repository selection available without expanding the rail", () => {
    expect(sidebarSource).toContain(
      "const repositorySelector = isCollapsed ? collapsedHeaderExtra : headerExtra;",
    );
    expect(chatShellSource).toContain(
      '<RepoSwitcher variant="rail" compact />',
    );
    expect(repoSwitcherSource).toContain("compact?: boolean;");
    expect(repoSwitcherSource).toContain("createPortal");
  });
});
