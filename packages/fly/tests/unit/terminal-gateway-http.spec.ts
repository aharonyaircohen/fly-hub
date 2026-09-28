import { spawn } from "node:child_process";
import { once } from "node:events";
import { expect, it } from "vitest";
import { mintTerminalBridgeToken } from "@kody-ade/terminal/terminal-token";
import { TERMINAL_BRIDGE_STATELESS_SCRIPT } from "../../src/plugin/terminal/bridge-stateless-script";

it("runs a machine-free registry job through the actual gateway HTTP boundary", async () => {
  const secret = "gateway-http-test-secret";
  const script = TERMINAL_BRIDGE_STATELESS_SCRIPT
    .replace('Number(process.env.PORT || 8080)', "0")
    .replace('console.log("stateless terminal gateway listening");', 'console.log(server.address().port);');
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    env: { PATH: process.env.PATH, BRIDGE_AUTH_SECRET: secret },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const [output] = await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => { throw new Error("Gateway exited before listening"); }),
    ]);
    const base = `http://127.0.0.1:${Number(String(output).trim())}`;
    const token = mintTerminalBridgeToken({ owner: "user-a", repo: "personal-brain", app: "brain-a", flyToken: "test-fly", localExec: true, secret });
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const jobId = "1234567890abcdef1234567890abcdef";
    const body = JSON.stringify({ jobId, local: true, command: "printf 'stage-start\\n'; sleep 0.2; printf 'stage-done\\n'", timeoutMs: 1000 });
    const started = await fetch(`${base}/jobs`, { method: "POST", headers, body });
    expect(started.status).toBe(202);
    expect((await started.json()).job.id).toBe(jobId);
    let sawProgress = false;
    let job: { status: string; stdout: string } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      job = (await (await fetch(`${base}/jobs/${jobId}`, { headers })).json()).job;
      if (job?.status === "running" && job.stdout.includes("stage-start")) sawProgress = true;
      if (job?.status === "completed") break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(sawProgress).toBe(true);
    expect(job).toMatchObject({ status: "completed", stdout: "stage-start\nstage-done\n" });
    const again = await fetch(`${base}/jobs`, { method: "POST", headers, body });
    expect((await again.json()).job.status).toBe("completed");
    expect((await fetch(`${base}/status`, { headers })).status).toBe(401);
    const other = mintTerminalBridgeToken({ owner: "user-b", repo: "personal-brain", app: "brain-a", flyToken: "test-fly", localExec: true, secret });
    expect((await fetch(`${base}/jobs/${jobId}`, { headers: { authorization: `Bearer ${other}` } })).status).toBe(404);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGKILL");
      await exited;
    }
  }
}, 10_000);
