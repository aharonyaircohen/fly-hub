import { afterEach, describe, expect, it, vi } from "vitest";
import {
  allocatePrivateIp,
  startMachine,
  waitForMachineStarted,
} from "../../builder/src/fly-api";

describe("waitForMachineStarted", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses Fly's supported timeout while a new Machine starts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetchMock);

    await waitForMachineStarted("managed-app", "machine-1", "token");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.machines.dev/v1/apps/managed-app/machines/machine-1/wait?state=started&timeout=60",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      }),
    );
  });

  it("allocates a private Flycast address for an isolated runtime app", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { allocateIpAddress: {} } }), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await allocatePrivateIp("managed-app-runtime", "token");

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({
        variables: { appId: "managed-app-runtime" },
        query: expect.stringContaining("private_v6"),
      }),
    );
  });

  it("treats an already-started Machine as a successful start", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 409 })));
    await expect(startMachine("managed-app", "machine-1", "token")).resolves.toBeUndefined();
  });

  it("retries while a newly created Machine is still preparing", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"error":"failed_precondition"}', { status: 412 }),
      )
      .mockResolvedValueOnce(new Response(null));
    vi.stubGlobal("fetch", fetchMock);

    const started = startMachine("managed-app", "machine-1", "token");
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(started).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
