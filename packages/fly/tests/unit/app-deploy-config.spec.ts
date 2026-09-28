import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appDeployConfig } from "../../builder/src/app-deploy-config";

describe("appDeployConfig", () => {
  it("provides flyctl with config for an app that has no Machines yet", () => {
    expect(appDeployConfig("managed-app", "fra")).toBe(
      'app = "managed-app"\nprimary_region = "fra"\n',
    );
  });

  it("keeps managed Machines registered for private DNS health checks", () => {
    const source = readFileSync(
      new URL("../../builder/src/app-builder.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("skipServiceRegistration: true");
  });
});
