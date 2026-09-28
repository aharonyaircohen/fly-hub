import { expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { brainImageRestoreCommand } from "../../src/image-runtime";

it("isolates registry credentials for concurrent restore jobs", () => {
  const command = brainImageRestoreCommand({ sourceImageRef: "ghcr.io/user/brain:saved", runtimeImageRef: "registry.fly.io/brain-user:saved", ghcrUser: "user" });
  expect(command).toContain('export DOCKER_CONFIG="$tmpdir/docker"');
  expect(command).toContain('export REGISTRY_AUTH_FILE="$tmpdir/registry-auth.json"');
  expect(command).toContain('--authfile "$REGISTRY_AUTH_FILE"');
  expect(command).toContain('skopeo login registry.fly.io --username x --password-stdin');
  expect(command).not.toContain("flyctl auth docker");
  const script = command.slice("/bin/bash -lc '".length, -1).replaceAll("'\\''", "'");
  const normalize = script.match(/node -e '([^']+)' \| skopeo/)?.[1];
  expect(normalize).toBeTruthy();
  expect(execFileSync(process.execPath, ["-e", normalize!], { env: { FLY_API_TOKEN: "FlyV1 fm1r_test,user-token" }, encoding: "utf8" })).toBe("fm1r_test");
});
