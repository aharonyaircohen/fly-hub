import { afterEach, it, expect, vi } from "vitest";
import { startRestoredMachine } from "../../builder/src/app-image-startup";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("allows an image to take longer than one minute to become startable", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response("", { status: 412 })
        : Response.json({
            state: Date.now() >= 70_000 ? "started" : "creating",
          }),
    ),
  );
  const promise = startRestoredMachine(
    "restored-app",
    "machine-123",
    "secret-token",
  );
  await vi.advanceTimersByTimeAsync(72_000);
  await expect(promise).resolves.toBeUndefined();
});

it("reports the machine, state, and last start status when startup stalls", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? new Response("sensitive body must not be logged", { status: 412 })
        : Response.json({ state: "creating" }),
    ),
  );
  const failure = startRestoredMachine(
    "restored-app",
    "machine-123",
    "secret-token",
    80_000,
  ).catch((e) => e);
  await vi.advanceTimersByTimeAsync(82_000);
  const error = await failure;
  expect(error.message).toContain("Machine machine-123 in restored-app");
  expect(error.message).toContain("state=creating; last start HTTP=412");
  expect(error.message).toContain("80 seconds");
  expect(error.message).not.toContain("secret-token");
  expect(error.message).not.toContain("sensitive body");
});

it("reports a destroyed machine immediately instead of waiting out the timeout", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ state: "destroyed" })),
  );
  await expect(
    startRestoredMachine("restored-app", "machine-123", "secret-token"),
  ).rejects.toThrow("state=destroyed");
  expect(fetch).toHaveBeenCalledTimes(1);
});
