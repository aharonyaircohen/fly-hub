import { describe, expect, it } from "vitest";

import {
  builderPublishDeploySpec,
  builderHostMachineIds,
  isBuilderHostMachine,
  redactBuilderPublishOutput,
} from "../../scripts/publish-preview-builder.mjs";

describe("publish-preview-builder host-machine cleanup", () => {
  it("targets only machines with no preview APP_NAME", () => {
    const hostMachine = {
      id: "host-machine",
      state: "started",
      config: { env: {} },
    };
    const emptyTargetMachine = {
      id: "empty-target-machine",
      state: "started",
      config: { env: { APP_NAME: "" } },
    };
    const previewJobMachine = {
      id: "preview-job",
      state: "started",
      config: { env: { APP_NAME: "kp-acme-widgets-pr-7" } },
    };

    expect(isBuilderHostMachine(hostMachine)).toBe(true);
    expect(isBuilderHostMachine(emptyTargetMachine)).toBe(true);
    expect(isBuilderHostMachine(previewJobMachine)).toBe(false);
    expect(
      builderHostMachineIds([
        hostMachine,
        emptyTargetMachine,
        previewJobMachine,
      ]),
    ).toEqual(["host-machine", "empty-target-machine"]);
  });

  it("redacts Fly tokens from captured command output", () => {
    expect(
      redactBuilderPublishOutput(
        "Bearer fly-secret FLY_API_TOKEN=fly-secret",
        "fly-secret",
      ),
    ).toBe("Bearer [redacted] FLY_API_TOKEN=[redacted]");
  });

  it("deploys from the builder directory so Docker COPY paths resolve", () => {
    const spec = builderPublishDeploySpec("kody-preview-builder");

    expect(spec.cwd.endsWith("/builder")).toBe(true);
    expect(spec.args).toContain("fly.toml");
    expect(spec.args).not.toContain("builder/fly.toml");
  });
});
