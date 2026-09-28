import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { brainImageRestoreCommand } from "../../src/image-runtime";

function runCopy(failures: number, error: string) {
  const dir = mkdtempSync(join(tmpdir(), "brain-copy-test-"));
  try {
    writeFileSync(join(dir, "skopeo"), `#!/bin/bash
if [ "$1" = login ]; then cat >/dev/null; exit 0; fi
count=$(cat "$COPY_COUNTER" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$COPY_COUNTER"
if [ "$count" -le "$COPY_FAILURES" ]; then
  echo "$COPY_ERROR" >&2
  exit 1
fi
`, { mode: 0o755 });
    writeFileSync(join(dir, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const command = brainImageRestoreCommand({
      sourceImageRef: "ghcr.io/test/brain:saved",
      runtimeImageRef: "registry.fly.io/brain-test:saved",
      ghcrUser: "test",
    });
    const script = command.slice("/bin/bash -lc '".length, -1).replaceAll("'\\''", "'");
    const result = spawnSync("/bin/bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env, PATH: `${dir}:${process.env.PATH}`,
        FLY_API_TOKEN: "fake-fly", GHCR_TOKEN: "fake-github",
        COPY_COUNTER: join(dir, "count"), COPY_FAILURES: String(failures), COPY_ERROR: error,
      },
    });
    return { ...result, attempts: Number(readFileSync(join(dir, "count"), "utf8")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

it("retries an interrupted upload and completes without replacing the source Brain", () => {
  const result = runCopy(2, "writing blob: unexpected EOF");
  expect(result.status).toBe(0);
  expect(result.attempts).toBe(3);
  expect(result.stdout).toContain("__KODY_BRAIN_RUNTIME_IMAGE_REF=registry.fly.io/brain-test:saved");
});

it("bounds retries and keeps signed upload URLs out of the error", () => {
  const result = runCopy(10, "writing blob https://registry.fly.io/uploads/private?_state=private-state: unexpected EOF");
  expect(result.status).toBe(1);
  expect(result.attempts).toBe(3);
  expect(result.stderr).toContain("Image upload was interrupted after 3 attempts");
  expect(result.stderr).not.toContain("private-state");
});

it("does not retry a permission failure", () => {
  const result = runCopy(10, "denied: requested access to the resource is denied");
  expect(result.status).toBe(1);
  expect(result.attempts).toBe(1);
  expect(result.stderr).toContain("Image registry access was denied");
});
