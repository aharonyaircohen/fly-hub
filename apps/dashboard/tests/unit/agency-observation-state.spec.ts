import { describe, expect, it } from "vitest";

import { ObservationSchema } from "@kody-ade/agency/observation-state";

const observation = {
  version: 1 as const,
  id: "obs-ci-main-2026-07-14t120000z",
  observerId: "agency-observer",
  capability: "observe-repo-ci",
  subject: "repo-ci:main",
  status: "unhealthy" as const,
  summary: "Default branch CI is failing",
  evidence: [{ kind: "check-run", label: "test", status: "failure" }],
  observedAt: "2026-07-14T12:00:00.000Z",
};

describe("agency observation state", () => {
  it("keeps Observation as internal evidence", () => {
    expect(ObservationSchema.parse(observation).status).toBe("unhealthy");
  });

  it("rejects unsafe ids", () => {
    expect(() => ObservationSchema.parse({ ...observation, id: "../../secrets" })).toThrow();
  });
});
