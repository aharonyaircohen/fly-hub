const stableBaseUrl = "https://kody-dashboard-khaki.vercel.app";
const requiredEnvironment = [
  "VERCEL_TOKEN",
  "VERCEL_ORG_ID",
  "VERCEL_PROJECT_ID",
  "KODY_MCP_TEST_CONVEX_URL",
  "E2E_GITHUB_TOKEN",
  "E2E_GITHUB_REPO",
  "KODY_SERVICE_KEY",
];

function command(label, args, env, cwd) {
  return { label, bin: "pnpm", args, cwd, env };
}

function candidateUrl(output) {
  const matches = output.match(/https:\/\/[a-z0-9-]+\.vercel\.app/gi) ?? [];
  const candidate = matches.find((url) => url !== stableBaseUrl);
  if (!candidate) throw new Error("Vercel did not return a candidate URL");
  return candidate;
}

export async function runMcpProductionRelease({ env, run, repoRoot }) {
  const missing = requiredEnvironment.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required release environment: ${missing.join(", ")}`,
    );
  }

  const sharedEnv = { ...process.env, ...env };
  const tokenArg = `--token=${env.VERCEL_TOKEN}`;
  const staged = await run(
    command(
      "stage production candidate",
      [
        "dlx",
        "vercel@54.10.2",
        "deploy",
        "--prod",
        "--skip-domain",
        "--yes",
        tokenArg,
      ],
      sharedEnv,
      repoRoot,
    ),
  );
  const deploymentUrl = candidateUrl(staged.stdout);
  const candidateEnv = {
    ...sharedEnv,
    KODY_MCP_TEST_BASE_URL: deploymentUrl,
    BASE_URL: deploymentUrl,
    CONVEX_URL: env.KODY_MCP_TEST_CONVEX_URL,
    E2E_CONVEX_URL: env.KODY_MCP_TEST_CONVEX_URL,
    MOCK_KODY_ACCOUNT_SESSION: "1",
  };

  await run(
    command(
      "full production MCP gate",
      [
        "--filter",
        "kody-dashboard",
        "test:live:mcp",
        "--",
        "--phase2-gates",
        "--phase3-gates",
        "--phase4-gates",
        "--phase5-gates",
      ],
      candidateEnv,
      repoRoot,
    ),
  );
  await run(
    command(
      "deployed Activity and Todo gate",
      [
        "--filter",
        "kody-dashboard",
        "exec",
        "playwright",
        "test",
        "tests/e2e/activity-agents-real.e2e.spec.ts",
        "--project=chromium",
      ],
      candidateEnv,
      repoRoot,
    ),
  );
  await run(
    command(
      "promote verified candidate",
      ["dlx", "vercel@54.10.2", "promote", deploymentUrl, "--yes", tokenArg],
      sharedEnv,
      repoRoot,
    ),
  );
  await run(
    command(
      "verify stable MCP endpoint",
      ["--filter", "kody-dashboard", "test:live:mcp"],
      { ...sharedEnv, KODY_MCP_TEST_BASE_URL: stableBaseUrl },
      repoRoot,
    ),
  );

  return { deploymentUrl, endpoint: `${stableBaseUrl}/api/kody/mcp` };
}
