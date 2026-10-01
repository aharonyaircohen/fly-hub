type MachineConfig = Record<string, unknown> & {
  env?: Record<string, string>;
  metadata?: Record<string, string>;
};

export async function clearAppBuilderCredentials(input: {
  app: string;
  machine: string;
  token: string;
  status: "completed" | "failed" | "cancelled";
  metadata?: Record<string, string>;
}) {
  const base = `https://api.machines.dev/v1/apps/${encodeURIComponent(input.app)}/machines/${encodeURIComponent(input.machine)}`;
  const headers = {
    authorization: `Bearer ${input.token}`,
    "content-type": "application/json",
  };
  const [machine, metadata] = await Promise.all([
    fetch(base, { headers, signal: AbortSignal.timeout(10_000) }).then(
      async (r) => {
        if (!r.ok) throw new Error(`Worker lookup HTTP ${r.status}`);
        return r.json() as Promise<{ config: MachineConfig }>;
      },
    ),
    fetch(`${base}/metadata`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    }).then(async (r) => {
      if (!r.ok) throw new Error(`Worker metadata HTTP ${r.status}`);
      return r.json() as Promise<Record<string, string>>;
    }),
  ]);
  if (!machine.config) throw new Error("Worker configuration missing");
  const env = machine.config.env ?? {};
  const response = await fetch(base, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      skip_launch: true,
      config: {
        ...machine.config,
        env: {},
        init: { cmd: ["sh", "-c", "exit 0"] },
        metadata: {
          ...metadata,
          ...input.metadata,
          flyhub_build_kind: "app",
          flyhub_build_app: env.APP_NAME || metadata.flyhub_build_app || "",
          flyhub_build_ref: env.REF || metadata.flyhub_build_ref || "",
          flyhub_build_task: env.APP_TASK_ID || metadata.flyhub_build_task || "",
          flyhub_build_org: env.FLY_ORG_SLUG || metadata.flyhub_build_org || "",
          flyhub_build_repo: env.REPO || metadata.flyhub_build_repo || "",
          flyhub_build_name:
            env.FLY_HUB_NAME ||
            metadata.flyhub_build_name ||
            env.APP_NAME ||
            "",
          flyhub_build_status: input.status,
        },
      },
    }),
  });
  if (!response.ok)
    throw new Error(`Worker credential cleanup HTTP ${response.status}`);
}
