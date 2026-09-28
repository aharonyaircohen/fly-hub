import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

import {
  assertLiveGateReport,
  assertLiveJourneyCoverage,
  buildPlaywrightArguments,
  buildLiveGateMetadata,
  configuredSecretValues,
  createStreamingSecretRedactor,
  isExpectedBrowserAbort,
  redactDiagnosticText,
  sanitizeLiveGateArtifacts,
  runLiveServicePreflight,
  sanitizeDiagnosticUrl,
  selectLiveJourneys,
  summarizePlaywrightReport,
  validateLiveGateEnvironment,
  validateBrainLifecycleEnvironment,
} from "../../scripts/live-ui-gate/core.mjs";
import {
  EXPECTED_LIVE_UI_TESTS,
  LIVE_UI_JOURNEYS,
  MISSING_LIVE_UI_JOURNEYS,
  LIVE_UI_SPECS,
} from "../../scripts/live-ui-gate/manifest.mjs";

const SECRET = "secret-value-that-must-never-be-printed";

function validEnvironment(): Record<string, string> {
  return {
    BASE_URL: "https://preview.example.test",
    RUN_REAL_E2E: "1",
    E2E_GITHUB_TOKEN: SECRET,
    E2E_GITHUB_REPO: "https://github.com/example/kody-e2e-tester",
    CONVEX_URL: "https://example.convex.cloud",
    KODY_SERVICE_KEY: SECRET,
    KODY_MASTER_KEY: SECRET,
  };
}

function reportWithStatuses(...statuses: string[]) {
  return {
    suites: [
      {
        title: "live",
        specs: statuses.map((status, index) => ({
          file: LIVE_UI_JOURNEYS[index]?.file ?? "tests/e2e/unknown.spec.ts",
          title: LIVE_UI_JOURNEYS[index]?.title ?? `journey ${index + 1}`,
          tests: [
            {
              expectedStatus: "passed",
              status,
              results: [{ status: status === "expected" ? "passed" : status }],
            },
          ],
        })),
      },
    ],
  };
}

describe("live UI gate environment", () => {
  it("accepts an explicitly enabled real test run", () => {
    expect(validateLiveGateEnvironment(validEnvironment())).toEqual([]);
  });

  it("accepts NEXT_PUBLIC_CONVEX_URL as the Convex endpoint", () => {
    const env = validEnvironment();
    delete env.CONVEX_URL;
    env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

    expect(validateLiveGateEnvironment(env)).toEqual([]);
  });

  it("rejects missing credentials without exposing available secret values", () => {
    const env = validEnvironment();
    delete env.KODY_SERVICE_KEY;

    const errors = validateLiveGateEnvironment(env);

    expect(errors).toContain("KODY_SERVICE_KEY is required");
    expect(JSON.stringify(errors)).not.toContain(SECRET);
  });

  it("rejects a disabled real-test mode", () => {
    const env = validEnvironment();
    env.RUN_REAL_E2E = "0";

    expect(validateLiveGateEnvironment(env)).toContain(
      "RUN_REAL_E2E must be exactly 1",
    );
  });

});

describe("Brain lifecycle gate environment", () => {
  it("requires an explicitly disposable destructive identity", () => {
    expect(validateBrainLifecycleEnvironment(validEnvironment())).toEqual([
      "KODY_LIVE_ALLOW_SAVE must be exactly 1",
      "KODY_LIVE_ALLOW_DESTRUCTIVE must be exactly 1",
      "KODY_LIVE_BRAIN_DISPOSABLE must be exactly 1 for the dedicated test identity",
    ]);
  });

  it("accepts the complete destructive lifecycle contract", () => {
    expect(
      validateBrainLifecycleEnvironment({
        KODY_LIVE_ALLOW_SAVE: "1",
        KODY_LIVE_ALLOW_DESTRUCTIVE: "1",
        KODY_LIVE_BRAIN_DISPOSABLE: "1",
      }),
    ).toEqual([]);
  });
});

describe("production browser gate target", () => {
  it("lets the Playwright config provide the isolated local server URL", () => {
    for (const file of [
      "auth-buttons.spec.ts",
      "brain-repo-route.spec.ts",
      "chat-brain-mocked.spec.ts",
      "chat-kody-attachments.spec.ts",
      "production-email-signin.spec.ts",
    ]) {
      const source = readFileSync(
        new URL(`../e2e/${file}`, import.meta.url),
        "utf8",
      );
      expect(source).not.toMatch(
        /process\.env\.PW_LOCAL\s*\?\s*["']http:\/\/127\.0\.0\.1:3333/,
      );
      expect(source).toContain("process.env.BASE_URL");
    }

    const rendererSource = readFileSync(
      new URL("../e2e/chat-renderer-output.spec.ts", import.meta.url),
      "utf8",
    );
    expect(rendererSource).toContain("process.env.BASE_URL");
  });
});

describe("live UI gate report", () => {
  it("counts passed, skipped, failed, and flaky tests recursively", () => {
    const report = reportWithStatuses(
      "expected",
      "skipped",
      "unexpected",
      "flaky",
    );

    expect(summarizePlaywrightReport(report)).toEqual({
      total: 4,
      passed: 1,
      skipped: 1,
      failed: 1,
      flaky: 1,
    });
  });

  it("fails when no live journeys execute", () => {
    expect(() => assertLiveGateReport(reportWithStatuses())).toThrow(
      "No live UI journeys executed",
    );
  });

  it("fails when any live journey skips", () => {
    expect(() =>
      assertLiveGateReport(reportWithStatuses("expected", "skipped")),
    ).toThrow("1 live UI journey skipped");
  });

  it("fails when a journey is flaky even if Playwright recovered", () => {
    expect(() =>
      assertLiveGateReport(reportWithStatuses("expected", "flaky")),
    ).toThrow("1 live UI journey was flaky");
  });

  it("accepts only a fully green report", () => {
    expect(
      assertLiveGateReport(reportWithStatuses("expected", "expected")),
    ).toEqual({
      total: 2,
      passed: 2,
      skipped: 0,
      failed: 0,
      flaky: 0,
    });
  });

  it("fails when Playwright discovers fewer journeys than the manifest", () => {
    expect(() =>
      assertLiveGateReport(reportWithStatuses("expected"), LIVE_UI_JOURNEYS),
    ).toThrow("Missing required live UI journeys");
  });

  it("matches Playwright JSON reports that use spec basenames", () => {
    const report = reportWithStatuses("expected");
    report.suites[0].specs[0].file =
      LIVE_UI_JOURNEYS[0].file.split("/").at(-1) ?? "";

    expect(() =>
      assertLiveGateReport(report, [LIVE_UI_JOURNEYS[0]]),
    ).not.toThrow();
  });
});

describe("live UI gate metadata", () => {
  it("records target identity without copying credentials", () => {
    const metadata = buildLiveGateMetadata(validEnvironment(), {
      commit: "abc123",
      startedAt: "2026-07-20T12:00:00.000Z",
    });

    expect(metadata).toMatchObject({
      commit: "abc123",
      startedAt: "2026-07-20T12:00:00.000Z",
      targetUrl: "https://preview.example.test",
      targetRepository: "https://github.com/example/kody-e2e-tester",
      realE2EEnabled: true,
      mutationsConfirmed: true,
      mutationTarget: "example/kody-e2e-tester",
    });
    expect(JSON.stringify(metadata)).not.toContain(SECRET);
  });
});

describe("live UI service preflight", () => {
  it("verifies Dashboard auth, the exact GitHub repository, and Convex service auth", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/api/kody/auth/me")) {
        return new Response(
          JSON.stringify({
            authenticated: true,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/api/kody/repository-models")) {
        return new Response(
          JSON.stringify({
            models: [
              {
                id: "minimax/MiniMax-M3",
                enabled: true,
                apiKeySecret: "MINIMAX_API_KEY",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/api/kody/secrets")) {
        return new Response(
          JSON.stringify({ secrets: [{ name: "MINIMAX_API_KEY" }] }),
          { status: 200 },
        );
      }
      if (url.includes("api.github.com/repos/")) {
        return new Response(
          JSON.stringify({ full_name: "example/kody-e2e-tester" }),
          {
            status: 200,
          },
        );
      }
      return new Response(JSON.stringify({ status: "success", value: [] }), {
        status: 200,
      });
    };

    await expect(
      runLiveServicePreflight(validEnvironment(), fetchImpl),
    ).resolves.toEqual([
      { name: "dashboard-auth", ok: true },
      { name: "dashboard-model-config", ok: true },
      { name: "dashboard-model-secret", ok: true },
      { name: "github-repository", ok: true },
      { name: "convex-service-auth", ok: true },
    ]);
    expect(requests).toHaveLength(5);
    expect(requests.map((request) => request.url)).toContain(
      "https://preview.example.test/api/kody/repository-models",
    );
    expect(requests.map((request) => request.url)).not.toContain(
      "https://preview.example.test/api/kody/models",
    );
    expect(JSON.stringify(requests)).toContain("x-kody-token");
    expect(JSON.stringify(requests)).toContain("serviceKey");
  });

  it("reports only failed check names and never response bodies or secrets", async () => {
    const fetchImpl = async () =>
      new Response(`remote failure ${SECRET}`, { status: 500 });

    await expect(
      runLiveServicePreflight(validEnvironment(), fetchImpl),
    ).rejects.toThrow(
      "Live service preflight failed: dashboard-auth, dashboard-model-config, dashboard-model-secret, github-repository, convex-service-auth",
    );
    await expect(
      runLiveServicePreflight(validEnvironment(), fetchImpl),
    ).rejects.not.toThrow(SECRET);
  });
});

describe("live UI diagnostic redaction", () => {
  it("removes URL credentials, queries, and fragments", () => {
    expect(
      sanitizeDiagnosticUrl(
        "https://user:password@example.test/path?token=secret#fragment",
      ),
    ).toBe("https://example.test/path");
  });

  it("redacts every configured secret from diagnostic text", () => {
    expect(
      redactDiagnosticText(`failed with ${SECRET} and second-secret`, [
        SECRET,
        "second-secret",
      ]),
    ).toBe("failed with [REDACTED] and [REDACTED]");
  });

  it("redacts secrets split across streamed process chunks", () => {
    let output = "";
    const redactor = createStreamingSecretRedactor([SECRET], (text: string) => {
      output += text;
    });

    redactor.write(`authorization: Bearer ${SECRET.slice(0, 12)}`);
    redactor.write(`${SECRET.slice(12)}\nnext line\n`);
    redactor.end();

    expect(output).toContain("authorization: Bearer [REDACTED]");
    expect(output).not.toContain(SECRET);
  });

  it("collects only populated secret environment values", () => {
    expect(
      configuredSecretValues({
        E2E_GITHUB_TOKEN: SECRET,
        KODY_MASTER_KEY: "",
        BASE_URL: "https://example.test",
      }),
    ).toEqual([SECRET]);
  });

  it("sanitizes text artifacts, replaces the unsafe HTML report, and removes unsafe binary artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "kody-live-redaction-"));
    const html = join(root, "html");
    const artifacts = join(root, "artifacts");
    mkdirSync(html, { recursive: true });
    mkdirSync(artifacts, { recursive: true });
    writeFileSync(
      join(root, "results.json"),
      JSON.stringify({ error: `authorization: Bearer ${SECRET}` }),
    );
    writeFileSync(
      join(artifacts, "error-context.md"),
      `token=${encodeURIComponent(SECRET)}`,
    );
    writeFileSync(
      join(artifacts, "unsafe.bin"),
      Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(SECRET)]),
    );
    writeFileSync(
      join(html, "index.html"),
      `<script>report=${Buffer.from(SECRET).toString("base64")}</script>`,
    );

    const result = sanitizeLiveGateArtifacts(root, [SECRET]);

    expect(readFileSync(join(root, "results.json"), "utf8")).toContain(
      "[REDACTED]",
    );
    expect(
      readFileSync(join(artifacts, "error-context.md"), "utf8"),
    ).not.toContain(encodeURIComponent(SECRET));
    expect(readFileSync(join(html, "index.html"), "utf8")).toContain(
      "Sanitized live UI report",
    );
    expect(result.removedFiles).toContain("artifacts/unsafe.bin");
    expect(result.remainingSecretMatches).toEqual([]);
  });

  it("distinguishes navigation cancellation from real network failure", () => {
    expect(isExpectedBrowserAbort("net::ERR_ABORTED")).toBe(true);
    expect(isExpectedBrowserAbort("net::ERR_CONNECTION_REFUSED")).toBe(false);
    expect(isExpectedBrowserAbort("net::ERR_NAME_NOT_RESOLVED")).toBe(false);
  });
});

describe("live UI gate manifest", () => {
  it("selects one exact journey by its stable test id", () => {
    expect(selectLiveJourneys(LIVE_UI_JOURNEYS, "direct-kody-chat")).toEqual([
      expect.objectContaining({
        id: "direct-kody-chat",
        file: "tests/e2e/direct-chat-real.e2e.spec.ts",
      }),
    ]);
  });

  it("rejects an unknown stable test id", () => {
    expect(() => selectLiveJourneys(LIVE_UI_JOURNEYS, "missing-test")).toThrow(
      "Unknown Quality test id: missing-test",
    );
  });

  it("wires every implemented live journey into the gate", () => {
    expect(LIVE_UI_SPECS).toEqual([
      "tests/e2e/loops-real-persistence.e2e.spec.ts",
      "tests/e2e/repository-secrets-real.e2e.spec.ts",
      "tests/e2e/activity-agents-real.e2e.spec.ts",
      "tests/e2e/memory-real.e2e.spec.ts",
      "tests/e2e/memory-llm-real.e2e.spec.ts",
      "tests/e2e/file-manager-real.e2e.spec.ts",
      "tests/e2e/agent-guidance-real.e2e.spec.ts",
      "tests/e2e/live-agent-real.e2e.spec.ts",
      "tests/e2e/direct-chat-real.e2e.spec.ts",
      "tests/e2e/chat-real-system.spec.ts",
      "tests/e2e/ci-repair-chat-real.e2e.spec.ts",
      "tests/e2e/chat-terminal-live-ui.spec.ts",
      "tests/e2e/brain-runtime-lifecycle-live.e2e.spec.ts",
      "tests/e2e/guided-flows-real.e2e.spec.ts",
      "tests/e2e/vibe-live-full-flow.spec.ts",
      "tests/e2e/view-renderers-real.e2e.spec.ts",
      "tests/e2e/master-journeys-real.e2e.spec.ts",
      "tests/e2e/views-real-browser-live.e2e.spec.ts",
    ]);
    expect(EXPECTED_LIVE_UI_TESTS).toBe(29);
    expect(LIVE_UI_JOURNEYS).toHaveLength(29);
    expect(new Set(LIVE_UI_JOURNEYS.map((journey) => journey.id)).size).toBe(
      29,
    );
  });

  it("has no unimplemented master-plan journeys", () => {
    expect(MISSING_LIVE_UI_JOURNEYS).toEqual([]);
    expect(() =>
      assertLiveJourneyCoverage(MISSING_LIVE_UI_JOURNEYS),
    ).not.toThrow();
  });

  it("runs serially with list, JSON, and HTML evidence", () => {
    expect(
      buildPlaywrightArguments(LIVE_UI_SPECS, {
        outputDir: "test-results/live-ui-gate/run/artifacts",
      }),
    ).toEqual([
      "exec",
      "playwright",
      "test",
      ...LIVE_UI_SPECS,
      "--config=playwright.live.config.ts",
      "--project=live-chromium",
      "--workers=1",
      "--reporter=list,json,html",
      "--output=test-results/live-ui-gate/run/artifacts",
    ]);
  });

  it("filters a Quality Run to the exact Playwright test title", () => {
    expect(
      buildPlaywrightArguments(["tests/e2e/direct-chat-real.e2e.spec.ts"], {
        grep: "sends a real direct-model turn",
      }),
    ).toContain("--grep=sends a real direct-model turn");
  });

  it("is exposed as blocking gate and preflight package scripts", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["test:e2e:live:gate"]).toBe(
      "node scripts/live-ui-gate/run.mjs",
    );
    expect(packageJson.scripts?.["test:e2e:live:preflight"]).toBe(
      "node scripts/live-ui-gate/run.mjs --preflight-only",
    );
  });

  it("captures and sanitizes Playwright output and artifacts before reporting", () => {
    const runner = readFileSync(
      new URL("../../scripts/live-ui-gate/run.mjs", import.meta.url),
      "utf8",
    );

    expect(runner).toContain("createStreamingSecretRedactor");
    expect(runner).toContain("sanitizeLiveGateArtifacts");
    expect(runner).not.toContain('stdio: "inherit"');
  });
});
