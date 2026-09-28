export type AppSourceKind =
  "dockerfile" | "fly" | "next" | "node" | "static" | "python" | "unsupported";

export interface AppSourcePlan {
  kind: AppSourceKind;
  rootDirectory: string;
  buildCommand?: string;
  startCommand?: string;
  port?: number;
  /** Optional same-container HTTP API exposed through the authenticated /api path. */
  apiPort?: number;
  questions?: string[];
  imageRef?: string;
  dockerfilePath?: string;
  dockerBuildTarget?: string;
  runtimeEnv?: Record<string, string>;
  generatedSecretNames?: string[];
  verification?: AppVerification;
}

export interface AppVerification {
  path: string;
  expectedStatus: number;
}

/** Select a same-origin HTTP request that represents the app being usable. */
export function detectAppVerification(
  files: Array<{ path: string; text: string }>,
): AppVerification {
  const source = files.map((file) => file.text).join("\n");
  const candidates = [
    "/api/config",
    "/readyz",
    "/ready",
    "/healthz",
    "/health",
  ];
  const path = candidates.find((candidate) => source.includes(candidate));
  return { path: path ?? "/", expectedStatus: 200 };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function generateFlyAppName(
  repository: string,
  appSlug: string,
): string {
  const identity = `${repository.toLowerCase()}/${appSlug.toLowerCase()}`;
  const readable = `${repository}-${appSlug}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `kody-app-${readable}-${stableHash(identity)}`;
}

const NON_SECRET_RUNTIME_NAMES =
  /^(NODE_ENV|PORT|HOST|HOSTNAME|NEXT_PUBLIC_|PUBLIC_|VITE_|FLY_|KODY_)/;
const SENSITIVE_NAME = /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)$/;
const GENERATED_PLACEHOLDER = /(?:change|replace)[-_ ]?me|your[-_]|<[^>]+>/i;

export function detectRuntimeEnvironment(
  files: Array<{ path: string; text: string }>,
): {
  requiredSecretNames: string[];
  generatedSecretNames: string[];
  runtimeEnv: Record<string, string>;
} {
  const required = new Set<string>();
  const generated = new Set<string>();
  const runtimeEnv: Record<string, string> = {};
  for (const file of files) {
    if (!/(^|\/)\.env(?:\.example|\.sample|\.template)$/.test(file.path))
      continue;
    for (const line of file.text.split(/\r?\n/)) {
      const match = line.match(
        /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/,
      );
      if (!match || NON_SECRET_RUNTIME_NAMES.test(match[1])) continue;
      const name = match[1];
      const value = match[2].replace(/^['"]|['"]$/g, "").trim();
      if (!value) {
        required.add(name);
        continue;
      }
      if (GENERATED_PLACEHOLDER.test(value) && SENSITIVE_NAME.test(name)) {
        generated.add(name);
        continue;
      }
      runtimeEnv[name] = value;
    }
  }
  return {
    requiredSecretNames: [...required].sort(),
    generatedSecretNames: [...generated].sort(),
    runtimeEnv: Object.fromEntries(
      Object.entries(runtimeEnv).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
export function detectRequiredSecretNames(
  files: Array<{ path: string; text: string }>,
): string[] {
  return detectRuntimeEnvironment(files).requiredSecretNames;
}

interface SourceInput {
  files: string[];
  rootDirectory?: string;
  readText(path: string): string | undefined;
}

const atRoot = (root: string, file: string) =>
  root === "." ? file : `${root}/${file}`;
const has = (files: string[], path: string) => files.includes(path);

function packageManager(files: string[]): "pnpm" | "yarn" | "npm" {
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("yarn.lock")) return "yarn";
  return "npm";
}

function commandPort(command?: string): number | undefined {
  const match = command?.match(/(?:--port|-p)\s+(\d{2,5})/);
  return match ? Number(match[1]) : undefined;
}

export function detectAppSource(input: SourceInput): AppSourcePlan {
  const rootDirectory =
    input.rootDirectory?.replace(/^\.\//, "").replace(/\/$/, "") || ".";
  const path = (file: string) => atRoot(rootDirectory, file);
  if (has(input.files, path("Dockerfile"))) {
    const dockerfile = input.readText(path("Dockerfile")) ?? "";
    const exposed = dockerfile
      .match(/^EXPOSE\s+([^\n#]+)/m)?.[1]
      ?.trim()
      .split(/\s+/)
      .map(Number)
      .filter((port) => Number.isInteger(port) && port > 0);
    return {
      kind: "dockerfile",
      rootDirectory,
      ...(exposed?.[0] ? { port: exposed[0] } : {}),
      ...(exposed?.[1] && /\bAPI_URL\b/.test(dockerfile)
        ? { apiPort: exposed[1] }
        : {}),
      ...(/^FROM\s+\S+\s+AS\s+single\s*$/im.test(dockerfile)
        ? { dockerBuildTarget: "single" }
        : {}),
    };
  }
  if (has(input.files, path("fly.toml"))) {
    const config = input.readText(path("fly.toml")) ?? "";
    const imageRef = config.match(/^\s*image\s*=\s*["']([^"']+)["']/m)?.[1];
    const dockerfilePath = config.match(
      /^\s*dockerfile\s*=\s*["']([^"']+)["']/m,
    )?.[1];
    const port = config.match(/^\s*internal_port\s*=\s*(\d+)/m)?.[1];
    return {
      kind: "fly",
      rootDirectory,
      ...(imageRef ? { imageRef } : {}),
      ...(dockerfilePath ? { dockerfilePath } : {}),
      ...(port ? { port: Number(port) } : {}),
    };
  }

  if (has(input.files, path("package.json"))) {
    let pkg: {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    try {
      pkg = JSON.parse(input.readText(path("package.json")) ?? "{}");
    } catch {
      return {
        kind: "unsupported",
        rootDirectory,
        questions: [
          "The package.json is invalid. Should Kody repair it before setup?",
        ],
      };
    }
    const manager = packageManager(input.files);
    const isNext = Boolean(
      pkg.dependencies?.next ||
      pkg.devDependencies?.next ||
      has(input.files, path("next.config.js")) ||
      has(input.files, path("next.config.mjs")),
    );
    const start = pkg.scripts?.start;
    if (!start && !isNext)
      return {
        kind: "unsupported",
        rootDirectory,
        questions: ["What command should start this Node application?"],
      };
    return {
      kind: isNext ? "next" : "node",
      rootDirectory,
      ...(pkg.scripts?.build ? { buildCommand: `${manager} build` } : {}),
      startCommand: `${manager} start`,
      port: commandPort(start) ?? 3000,
    };
  }
  if (
    has(input.files, path("requirements.txt")) ||
    has(input.files, path("pyproject.toml"))
  ) {
    const procfile = input.readText(path("Procfile"));
    const startCommand = procfile?.match(/^web:\s*(.+)$/m)?.[1];
    return {
      kind: "python",
      rootDirectory,
      ...(startCommand
        ? { startCommand }
        : {
            questions: ["What command should start this Python application?"],
          }),
    };
  }
  if (has(input.files, path("index.html")))
    return { kind: "static", rootDirectory, port: 8080 };
  return {
    kind: "unsupported",
    rootDirectory,
    questions: [
      "Which directory contains the application and how should it be started?",
    ],
  };
}
