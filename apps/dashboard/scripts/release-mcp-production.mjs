import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runMcpProductionRelease as runRelease } from "./release-mcp-production-core.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export async function runMcpProductionRelease({
  env = process.env,
  run = runCommand,
} = {}) {
  return runRelease({ env, run, repoRoot });
}

export function runCommand(spec, { forwardOutput = true } = {}) {
  return new Promise((resolvePromise, reject) => {
    if (forwardOutput) process.stdout.write(`\n[release] ${spec.label}\n`);
    const child = spawn(spec.bin, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (forwardOutput) process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (forwardOutput) process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else {
        const error = new Error(`${spec.label} failed with exit code ${code}`);
        error.releaseStage = spec.label;
        error.releaseDetail = safeFailureDetail(spec, stdout, stderr, code);
        reject(error);
      }
    });
  });
}

export function kodyCapabilitySuccess({ deploymentUrl, endpoint }) {
  return {
    version: 1,
    status: "pass",
    summary: "Dashboard candidate passed every gate and was promoted.",
    evidence: { productionDeployed: true },
    facts: {
      productionDeploymentUrl: deploymentUrl,
      mcpEndpoint: endpoint,
    },
    artifacts: [{ label: "Vercel deployment", url: deploymentUrl }],
    missingEvidence: [],
    blockers: [],
  };
}

export function kodyCapabilityFailure(error) {
  const failedStage =
    error && typeof error === "object" && "releaseStage" in error
      ? String(error.releaseStage)
      : "release setup";
  const failedDetail =
    error && typeof error === "object" && "releaseDetail" in error
      ? String(error.releaseDetail)
      : "command failed";
  const summary = `Dashboard release failed at ${failedStage}: ${failedDetail}. The stable deployment was not changed.`;
  return {
    version: 1,
    status: "fail",
    summary,
    evidence: {},
    facts: { failedStage },
    artifacts: [],
    missingEvidence: ["productionDeployed"],
    blockers: [summary],
  };
}

function safeFailureDetail(spec, stdout, stderr, code) {
  let output = `${stderr}\n${stdout}`.replace(/\u001b\[[0-9;]*m/g, "");
  for (const [name, value] of Object.entries(spec.env ?? {})) {
    if (!/(?:TOKEN|KEY|SECRET|PASSWORD)/i.test(name)) continue;
    if (typeof value === "string" && value.length >= 6) {
      output = output.replaceAll(value, "[redacted]");
    }
  }
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const detail =
    [...lines]
      .reverse()
      .find((line) =>
        /(?:error|failed|invalid|unauthorized|not found|unknown)/i.test(line),
      ) ?? `command exited with code ${code}`;
  return detail.replace(/--token=\S+/gi, "--token=[redacted]").slice(0, 240);
}

function writeCapabilityResult(result) {
  process.stdout.write(`KODY_CAPABILITY_RESULT=${JSON.stringify(result)}\n`);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  const capabilityRun = process.env.KODY_CAPABILITY_RUN === "1";
  runMcpProductionRelease({
    run: capabilityRun
      ? (spec) => runCommand(spec, { forwardOutput: false })
      : runCommand,
  })
    .then(({ deploymentUrl, endpoint }) => {
      if (capabilityRun) {
        writeCapabilityResult(
          kodyCapabilitySuccess({ deploymentUrl, endpoint }),
        );
        return;
      }
      process.stdout.write(
        `\n[release] promoted ${deploymentUrl}\n[release] MCP ${endpoint}\n`,
      );
    })
    .catch((error) => {
      if (capabilityRun) {
        writeCapabilityResult(kodyCapabilityFailure(error));
        return;
      }
      process.stderr.write(
        `[release] stopped: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
