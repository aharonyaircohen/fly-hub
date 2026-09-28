import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateProjectAssessmentReport } from "../../app/api/kody/chat/kody/project-assessment-report";
import { projectAssessmentTitle } from "../../app/api/kody/chat/kody/project-assessment-report";
import { COMPLETE_PROJECT_ASSESSMENT } from "../fixtures/project-assessment-report";

describe("project assessment report validation", () => {
  it.each([
    ["# הערכת הפרויקט", "הערכת הפרויקט"],
    ["# Evaluación del proyecto", "Evaluación del proyecto"],
    ["# プロジェクト評価", "プロジェクト評価"],
  ])("uses a writer-provided H1 in any language", (heading, expected) => {
    expect(projectAssessmentTitle(`${heading}\n\n## Section\n\nContent`)).toBe(
      expected,
    );
  });

  it("accepts a complete report", () => {
    expect(
      validateProjectAssessmentReport({
        text: COMPLETE_PROJECT_ASSESSMENT,
        finishReason: "stop",
      }),
    ).toEqual({ valid: true });
  });

  it("accepts the same complete structure with translated headings and labels", () => {
    const translated = COMPLETE_PROJECT_ASSESSMENT
      .replace("# Project assessment", "# הערכת פרויקט")
      .replace("## Executive verdict", "## מסקנה ניהולית")
      .replace("## Product readiness", "## מוכנות המוצר")
      .replace("## Ranked risks", "## סיכונים לפי עדיפות")
      .replace("## Maintenance capacity gap", "## פער יכולת התחזוקה")
      .replace("## Why Kody matters", "## מדוע Kody חשוב")
      .replace("## Kody coverage and proof", "## כיסוי והוכחות של Kody")
      .replace("## Advanced continuous QA", "## אבטחת איכות רציפה מתקדמת")
      .replace("## Recommended 30-day decisions", "## החלטות מומלצות ל-30 יום")
      .replace("## Recommended 90-day outcomes", "## תוצאות מומלצות ל-90 יום")
      .replace("## Technical assessment", "## הערכה טכנית")
      .replace("## Specialist findings and evidence", "## ממצאי מומחים וראיות")
      .replaceAll("**Current state:**", "**מצב נוכחי:**")
      .replaceAll("**Main risk:**", "**סיכון מרכזי:**")
      .replaceAll("**Maintenance capacity:**", "**יכולת תחזוקה:**")
      .replaceAll("**Kody's value:**", "**הערך של Kody:**")
      .replaceAll("**Next step:**", "**הצעד הבא:**")
      .replaceAll("**Severity:**", "**חומרה:**")
      .replaceAll("**Business impact:**", "**השפעה עסקית:**")
      .replaceAll("**Evidence:**", "**ראיות:**")
      .replaceAll("**Action:**", "**פעולה:**");

    expect(
      validateProjectAssessmentReport({ text: translated, finishReason: "stop" }),
    ).toEqual({ valid: true });
  });

  it("rejects the incomplete report that ended by attempting another tool call", () => {
    const brokenReport = readFileSync(
      new URL("../fixtures/incomplete-project-assessment.md", import.meta.url),
      "utf8",
    );

    expect(validateProjectAssessmentReport({ text: brokenReport })).toEqual(
      expect.objectContaining({ valid: false }),
    );
  });

  it("rejects a structurally complete report without a localized H1 title", () => {
    expect(
      validateProjectAssessmentReport({
        text: COMPLETE_PROJECT_ASSESSMENT.replace("# Project assessment\n\n", ""),
        finishReason: "stop",
      }),
    ).toEqual(
      expect.objectContaining({ valid: false, reason: "missing_title" }),
    );
  });

  it("rejects complete-looking text when the model did not finish normally", () => {
    expect(
      validateProjectAssessmentReport({
        text: COMPLETE_PROJECT_ASSESSMENT,
        finishReason: "length",
      }),
    ).toEqual(
      expect.objectContaining({ valid: false, reason: "unfinished_output" }),
    );
  });
});
