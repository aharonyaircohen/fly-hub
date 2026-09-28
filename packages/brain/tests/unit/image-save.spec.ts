/**
 * @fileoverview Brain image save command security and cleanup behavior.
 * @testFramework vitest
 */
import { describe, expect, it } from "vitest";

import {
  brainImageBuildCommand,
  settledBrainImageSave,
} from "../../src/image-save";

describe("settledBrainImageSave", () => {
  const operation = {
    id: "save-1",
    type: "save-image" as const,
    status: "completed" as const,
    imageRef: "ghcr.io/kody/brain:saved",
    startedAt: "2026-09-12T12:00:00.000Z",
    updatedAt: "2026-09-12T12:05:00.000Z",
  };

  it("recovers a completed result after a competing poll clears the job", () => {
    expect(settledBrainImageSave(operation, "save-1")).toEqual({
      status: "completed",
      jobId: "save-1",
      imageRef: "ghcr.io/kody/brain:saved",
      startedAt: "2026-09-12T12:00:00.000Z",
      finishedAt: "2026-09-12T12:05:00.000Z",
    });
  });

  it("does not return another or still-running operation", () => {
    expect(settledBrainImageSave(operation, "save-2")).toBeNull();
    expect(
      settledBrainImageSave({ ...operation, status: "running" }, "save-1"),
    ).toBeNull();
  });

  it("preserves a durable save failure for every poller", () => {
    expect(
      settledBrainImageSave(
        { ...operation, status: "failed", error: "registry unavailable" },
        "save-1",
      ),
    ).toEqual({
      status: "failed",
      jobId: "save-1",
      error: "registry unavailable",
    });
  });
});

describe("brainImageBuildCommand", () => {
  it("keeps GHCR credentials inside the disposable save directory", () => {
    const command = brainImageBuildCommand({
      app: "brain-app",
      machineId: "machine-123",
      orgSlug: "kody",
      tag: "20260713t151212z",
      baseImageRef: "ghcr.io/kody/base:latest",
      imageRef: "ghcr.io/kody/kody-brain-aguy:20260713t151212z",
      ghcrUser: "aguy",
    });

    expect(command).toContain('export DOCKER_CONFIG="$tmpdir/docker"');
    expect(command).toContain('install -d -m 0700 "$DOCKER_CONFIG"');
    expect(command).not.toContain("/root/.docker");
    expect(command.indexOf("export DOCKER_CONFIG")).toBeLessThan(
      command.indexOf("crane auth login"),
    );
  });

  it("excludes Brain SSH and agent access material from the exported rootfs", () => {
    const command = brainImageBuildCommand({
      app: "brain-app",
      machineId: "machine-123",
      orgSlug: "kody",
      tag: "20260713t151212z",
      baseImageRef: "ghcr.io/kody/base:latest",
      imageRef: "ghcr.io/kody/kody-brain-aguy:20260713t151212z",
      ghcrUser: "aguy",
    });

    expect(command).toContain("--exclude=etc/kody-ssh");
    expect(command).toContain("--exclude=etc/kody-agent");
    expect(command).toContain("--exclude=root/.kody-ssh");
    expect(command).toContain("home/*/.kody-ssh");
  });

  it("does not hold a completed save open on a Fly tunnel cleanup", () => {
    const command = brainImageBuildCommand({
      app: "brain-app",
      machineId: "machine-123",
      orgSlug: "kody",
      tag: "20260713t151212z",
      baseImageRef: "ghcr.io/kody/base:latest",
      imageRef: "ghcr.io/kody/kody-brain-aguy:20260713t151212z",
      ghcrUser: "aguy",
    });
    const cleanup = command.slice(
      command.indexOf("cleanup()"),
      command.indexOf("trap cleanup EXIT"),
    );
    expect(cleanup).not.toContain("flyctl ssh");
  });
});
