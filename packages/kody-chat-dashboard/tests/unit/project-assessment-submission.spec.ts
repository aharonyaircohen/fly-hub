import { describe, expect, it } from "vitest";

import { buildProjectAssessmentSubmission } from "../../src/dashboard/lib/chat/core/project-assessment-submission";
import { routeProjectAssessmentSubmission } from "../../app/api/kody/chat/kody/public-agent-routing";

describe("completed project assessment intake", () => {
  it("passes only the seven saved answers into specialist routing", () => {
    const text = buildProjectAssessmentSubmission("assessment-1", {
      projectExpectations: "grow",
      businessCriticality: "customer-facing",
      teamSizeAndRoles: "one founder and agents",
      relevantExperience: "strong product experience",
      systemKnowledge: "founder-owned",
      maintenanceTime: "four hours weekly",
      additionalComments: "write in Hebrew",
      stepResults: { large: "internal flow history" },
    });

    expect(text).toContain('"additionalComments":"write in Hebrew"');
    expect(text).not.toContain("internal flow history");
    expect(
      routeProjectAssessmentSubmission(text, [
        {
          slug: "cto",
          title: "CTO",
          body: "Assess project health.",
          capabilities: ["assess-architecture"],
        },
      ]),
    ).toMatchObject({
      mode: "delegate",
      assignments: [{ capability: "assess-architecture" }],
    });
  });
});
