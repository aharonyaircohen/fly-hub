// Large restored images may take several minutes to pull and unpack in Fly.
// Poll the actual machine state so a slow image pull isn't mistaken for failure.
export async function startRestoredMachine(
  app: string,
  id: string,
  token: string,
  timeoutMs = 10 * 60_000,
) {
  const url = `https://api.machines.dev/v1/apps/${encodeURIComponent(app)}/machines/${encodeURIComponent(id)}`;
  const headers = { authorization: `Bearer ${token}` };
  const deadline = Date.now() + timeoutMs;
  let state = "unknown",
    lastHttp = "none",
    lastLoggedState = "";
  const description = () =>
    `Machine ${id} in ${app}; state=${state}; last start HTTP=${lastHttp}`;
  while (Date.now() < deadline) {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (![408, 429].includes(response.status) && response.status < 500)
        throw new Error(
          `${description()}. Could not check startup (HTTP ${response.status}).`,
        );
    } else {
      const machine = (await response.json()) as { state: string };
      state = machine.state;
      if (state !== lastLoggedState) {
        console.log(`[saved-app] startup ${app}/${id}: ${state}`);
        lastLoggedState = state;
      }
      if (state === "started") return;
      if (["destroyed", "failed"].includes(state))
        throw new Error(
          `${description()}. The restored machine failed before startup completed.`,
        );
      const start = await fetch(`${url}/start`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      lastHttp = String(start.status);
      await start.body?.cancel();
      // 412 means the image/machine is not startable yet; 409 covers an active transition.
      if (
        !start.ok &&
        ![408, 409, 412, 429].includes(start.status) &&
        start.status < 500
      )
        throw new Error(`${description()}. Fly rejected machine startup.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `${description()}. Startup did not finish within ${Math.round(timeoutMs / 1000)} seconds. Check this machine's Fly logs for image pull or boot errors.`,
  );
}
