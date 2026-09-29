import { describe, expect, it } from "vitest";
import { parseEveAppPlan } from "@dashboard/lib/eve-app-plan";

const example = {
  summary: "Run the dashboard",
  service: "dashboard",
  rootDirectory: ".",
  startCommand: "hermes dashboard --host 0.0.0.0 --port 9119 --no-open",
  port: 9119,
  persistentPaths: ["/opt/data"],
  requiredSecrets: ["OPENAI_API_KEY"],
  generatedSecrets: ["HERMES_DASHBOARD_BASIC_AUTH_SECRET"],
  appPasswordEnv: "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD",
  runtimeEnv: { HERMES_DASHBOARD_BASIC_AUTH_USERNAME: "admin" },
  questions: [],
  verificationPath: "/api/status",
  evidence: ["Dockerfile"],
};

describe("Eve app plan validation", () => {
  it("accepts a fenced structured plan and keeps credentials as names", () => {
    expect(
      parseEveAppPlan(
        `Here is the plan:\n\`\`\`json\n${JSON.stringify(example)}\n\`\`\``,
      ),
    ).toMatchObject({ port: 9119, persistentPaths: ["/opt/data"] });
  });

  it("rejects unsafe or ambiguous values before the builder sees them", () => {
    expect(() =>
      parseEveAppPlan({
        ...example,
        runtimeEnv: { OPENAI_API_KEY: "secret-value" },
      }),
    ).toThrow();
    expect(() =>
      parseEveAppPlan({
        ...example,
        persistentPaths: ["/opt/../etc"],
      }),
    ).toThrow();
    expect(() =>
      parseEveAppPlan({
        ...example,
        port: null,
        requiredSecrets: ["OPENAI_API_KEY (paste your key)"],
      }),
    ).toThrow();
  });

  it("does not ask for a password Fly Hub will generate", () => {
    expect(
      parseEveAppPlan({
        ...example,
        requiredSecrets: [
          "OPENAI_API_KEY",
          "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD",
        ],
      }).requiredSecrets,
    ).toEqual(["OPENAI_API_KEY"]);
  });
});
