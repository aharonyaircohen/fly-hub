import { describe, expect, it } from "vitest";

import {
  availableReportTypes,
  filterReportsByType,
  normalizeReportType,
  reportTypeLabel,
} from "@dashboard/lib/report-types";

const reports = [
  { slug: "ci", reportType: "finding" },
  { slug: "lesson", reportType: "learning" },
  { slug: "audit", reportType: "security-audit" },
  { slug: "legacy", reportType: "general" },
];

describe("report types", () => {
  it("keeps custom types while normalizing unsafe or absent values", () => {
    expect(normalizeReportType("security-audit")).toBe("security-audit");
    expect(normalizeReportType("Finding Report")).toBe("general");
    expect(normalizeReportType(null)).toBe("general");
  });

  it("builds filters from every report type", () => {
    expect(availableReportTypes(reports)).toEqual([
      "finding",
      "general",
      "learning",
      "security-audit",
    ]);
    expect(reportTypeLabel("security-audit")).toBe("Security Audit");
  });

  it("filters reports without hardcoding finding or learning", () => {
    expect(filterReportsByType(reports, "learning").map((report) => report.slug)).toEqual([
      "lesson",
    ]);
    expect(filterReportsByType(reports, null)).toEqual(reports);
  });
});
