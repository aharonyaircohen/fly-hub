import { describe, expect, it } from "vitest";
import { taskBuildSchema } from "@dashboard/lib/fly-hub-task-build";

describe("Eve-led Fly Hub build input", () => {
  it("accepts a Dockerfile and bounded runtime settings", () => {
    expect(
      taskBuildSchema.parse({
        rootDirectory: ".",
        dockerfileContent: "FROM nginx:alpine\nCOPY . /usr/share/nginx/html\n",
        port: 8080,
        storagePath: "/opt/data",
        runtimeEnv: { HERMES_DASHBOARD_BASIC_AUTH_USERNAME: "admin" },
        appPasswordEnv: "HERMES_DASHBOARD_BASIC_AUTH_PASSWORD",
        generatedSecrets: ["HERMES_DASHBOARD_BASIC_AUTH_SECRET"],
      }).port,
    ).toBe(8080);
  });

  it("rejects paths that escape the repo or put credentials in public env", () => {
    expect(() =>
      taskBuildSchema.parse({ port: 8080, rootDirectory: "../private" }),
    ).toThrow();
    expect(() =>
      taskBuildSchema.parse({ port: 8080, storagePath: "/opt/../etc" }),
    ).toThrow();
    expect(() =>
      taskBuildSchema.parse({ port: 8080, runtimeEnv: { API_KEY: "secret" } }),
    ).toThrow();
  });
});
