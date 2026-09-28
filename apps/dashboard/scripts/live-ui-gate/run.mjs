import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotenv } from "dotenv";

import {
  assertLiveGateReport,
  assertLiveJourneyCoverage,
  buildLiveGateMetadata,
  buildPlaywrightArguments,
  configuredSecretValues,
  createStreamingSecretRedactor,
  runLiveServicePreflight,
  sanitizeLiveGateArtifacts,
  selectLiveJourneys,
  summarizePlaywrightReport,
  validateLiveGateEnvironment,
  validateBrainLifecycleEnvironment,
} from "./core.mjs";
import {
  EXPECTED_LIVE_UI_TESTS,
  LIVE_UI_JOURNEYS,
  LIVE_UI_SPECS,
  MISSING_LIVE_UI_JOURNEYS,
} from "./manifest.mjs";

const dashboardRoot = fileURLToPath(new URL("../..", import.meta.url));
loadDotenv({ path: join(dashboardRoot, ".env"), override: false, quiet: true });

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
  process.stderr.write(`Live UI gate blocked: ${message}\n`);
  process.exitCode = 1;
}

function currentCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: dashboardRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

const environmentErrors = validateLiveGateEnvironment(process.env);
if (environmentErrors.length > 0) {
  for (const error of environmentErrors) fail(error);
  process.exit();
}

const requestedTestId =
  argumentValue("--test-id") ?? process.env.QUALITY_TEST_ID ?? "";
let selectedJourneys;
try {
  selectedJourneys = selectLiveJourneys(LIVE_UI_JOURNEYS, requestedTestId);
} catch (error) {
  fail(error instanceof Error ? error.message : "Unknown Quality test id");
  process.exit();
}
const selectedSpecs = [
  ...new Set(selectedJourneys.map((journey) => journey.file)),
];
if (selectedJourneys.some((journey) => journey.id === "brain-runtime-lifecycle")) {
  const lifecycleErrors = validateBrainLifecycleEnvironment(process.env);
  if (lifecycleErrors.length > 0) {
    for (const error of lifecycleErrors) fail(error);
    process.exit();
  }
}

try {
  const checks = await runLiveServicePreflight(process.env);
  for (const check of checks) {
    process.stdout.write(`PASS ${check.name}\n`);
  }
} catch (error) {
  const message =
    error instanceof Error ? error.message : "Live service preflight failed";
  fail(message);
  process.exit();
}

const startedAt = new Date().toISOString();
const requestedRunId =
  argumentValue("--run-id") ?? process.env.QUALITY_RUN_ID ?? "";
const runId = /^[A-Za-z0-9_-]{1,200}$/.test(requestedRunId)
  ? requestedRunId
  : startedAt.replace(/[:.]/g, "-");
const artifactDir = join(dashboardRoot, "test-results", "live-ui-gate", runId);
const reportPath = join(artifactDir, "results.json");
const htmlPath = join(artifactDir, "html");
const outputPath = join(artifactDir, "artifacts");
mkdirSync(artifactDir, { recursive: true });

const metadata = {
  ...buildLiveGateMetadata(process.env, {
    commit: currentCommit(),
    startedAt,
  }),
  expectedTests: requestedTestId
    ? selectedJourneys.length
    : EXPECTED_LIVE_UI_TESTS,
  specs: requestedTestId ? selectedSpecs : LIVE_UI_SPECS,
  testId: requestedTestId || null,
  notImplemented: requestedTestId ? [] : MISSING_LIVE_UI_JOURNEYS,
};
writeFileSync(
  join(artifactDir, "metadata.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
  "utf8",
);

const displayDir = relative(dashboardRoot, artifactDir);
process.stdout.write(
  `Live UI gate target confirmed. Artifacts: ${displayDir}\n`,
);

if (process.argv.includes("--preflight-only")) {
  process.stdout.write(
    "Live UI gate preflight passed; Playwright was not run.\n",
  );
  process.exit();
}

const playwrightEnvironment = {
  ...process.env,
  PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath,
  PLAYWRIGHT_HTML_OUTPUT_DIR: htmlPath,
  PLAYWRIGHT_HTML_OPEN: "never",
};

const playwrightSecrets = configuredSecretValues(playwrightEnvironment);
const stdoutRedactor = createStreamingSecretRedactor(
  playwrightSecrets,
  (text) => process.stdout.write(text),
);
const stderrRedactor = createStreamingSecretRedactor(
  playwrightSecrets,
  (text) => process.stderr.write(text),
);
const playwrightChild = spawn(
  "pnpm",
  buildPlaywrightArguments(selectedSpecs, {
    outputDir: outputPath,
    ...(requestedTestId ? { grep: selectedJourneys[0].title } : {}),
  }),
  {
    cwd: dashboardRoot,
    env: playwrightEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  },
);

playwrightChild.stdout.setEncoding("utf8");
playwrightChild.stderr.setEncoding("utf8");
playwrightChild.stdout.on("data", (chunk) => stdoutRedactor.write(chunk));
playwrightChild.stderr.on("data", (chunk) => stderrRedactor.write(chunk));

const playwright = await new Promise((resolve) => {
  let settled = false;
  playwrightChild.once("error", (error) => {
    if (settled) return;
    settled = true;
    resolve({ error, status: null });
  });
  playwrightChild.once("close", (status) => {
    if (settled) return;
    settled = true;
    resolve({ error: null, status });
  });
});
stdoutRedactor.end();
stderrRedactor.end();

const artifactSecurity = sanitizeLiveGateArtifacts(
  artifactDir,
  playwrightSecrets,
);
if (artifactSecurity.remainingSecretMatches.length > 0) {
  fail("Secret material remained in live-test artifacts after sanitization");
  process.exit();
}

if (playwright.error) {
  fail("Playwright could not start");
  process.exit();
}

if (!existsSync(reportPath)) {
  fail("Playwright did not produce the required JSON report");
  process.exit();
}

let observedSummary;
try {
  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  observedSummary = summarizePlaywrightReport(report);
  const summary = assertLiveGateReport(report, selectedJourneys);
  const completeSummary = {
    ...summary,
    notImplemented: requestedTestId ? 0 : MISSING_LIVE_UI_JOURNEYS.length,
  };
  writeFileSync(
    join(artifactDir, "summary.json"),
    `${JSON.stringify(completeSummary, null, 2)}\n`,
    "utf8",
  );
  if (!requestedTestId) assertLiveJourneyCoverage(MISSING_LIVE_UI_JOURNEYS);
  if (playwright.status !== 0) {
    fail(`Playwright exited with status ${playwright.status ?? "unknown"}`);
  } else {
    process.stdout.write(
      `Live UI gate passed: ${summary.passed}/${summary.total} journeys.\n`,
    );
  }
  if (requestedTestId) {
    const result = {
      testId: requestedTestId,
      artifactPath: relative(join(dashboardRoot, "../.."), artifactDir),
      passed: summary.passed,
      failed: summary.failed,
      sourceCommit: metadata.commit,
    };
    process.stdout.write(`KODY_QUALITY_RESULT=${JSON.stringify(result)}\n`);
  }
} catch (error) {
  if (requestedTestId && observedSummary) {
    const result = {
      testId: requestedTestId,
      artifactPath: relative(join(dashboardRoot, "../.."), artifactDir),
      passed: observedSummary.passed,
      failed: Math.max(
        1,
        observedSummary.failed +
          observedSummary.skipped +
          observedSummary.flaky,
      ),
      sourceCommit: metadata.commit,
    };
    process.stdout.write(`KODY_QUALITY_RESULT=${JSON.stringify(result)}\n`);
  }
  const message = error instanceof Error ? error.message : "invalid report";
  fail(message);
}
