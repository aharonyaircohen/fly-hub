import { z } from "zod";

const name = z.string().regex(/^[A-Z_][A-Z0-9_]{0,99}$/);
const absolutePath = z
  .string()
  .min(2)
  .max(200)
  .refine(
    (value) => value.startsWith("/") && !value.split("/").includes(".."),
    "Storage paths must be absolute and cannot contain '..'.",
  );

const planSchema = z.object({
  summary: z.string().max(2_000).default(""),
  usage: z.string().max(2_000).default(""),
  credentialNotes: z.string().max(1_000).default(""),
  service: z.string().max(120).default(""),
  rootDirectory: z
    .string()
    .regex(/^(?:\.|[\w.-]+(?:\/[\w.-]+)*)$/)
    .max(200)
    .default("."),
  startCommand: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine(
      (value) =>
        !/[\r\n]/.test(value) && !/(?:\bor:|\bor\s+run\b)/i.test(value),
      "Choose one startup command.",
    )
    .nullable()
    .optional(),
  port: z.number().int().min(1).max(65_535).nullable().optional(),
  persistentPaths: z.array(absolutePath).max(1).default([]),
  requiredSecrets: z.array(name).max(20).default([]),
  generatedSecrets: z.array(name).max(20).default([]),
  appPasswordEnv: name.nullable().optional(),
  runtimeEnv: z.record(name, z.string().max(500)).default({}),
  questions: z.array(z.string().min(1).max(500)).max(20).default([]),
  verificationPath: z
    .string()
    .regex(/^\/[\w./?=&%-]*$/)
    .max(200)
    .default("/"),
  evidence: z.array(z.string().max(500)).max(20).default([]),
});

export type EveAppPlan = z.infer<typeof planSchema>;

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const unwrapped = fenced ?? trimmed;
  return JSON.parse(unwrapped) as unknown;
}

export function parseEveAppPlan(value: unknown): EveAppPlan {
  const result = planSchema.safeParse(parseJson(value));
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `Invalid ${issue?.path.join(".") || "plan"}: ${issue?.message || "unknown error"}`,
    );
  }
  const parsed = result.data;
  if (parsed.rootDirectory.split("/").includes(".."))
    throw new Error("Eve proposed an invalid app directory.");
  parsed.requiredSecrets = parsed.requiredSecrets.filter(
    (item) =>
      item !== parsed.appPasswordEnv && !parsed.generatedSecrets.includes(item),
  );
  const names = [
    ...parsed.requiredSecrets,
    ...parsed.generatedSecrets,
    ...(parsed.appPasswordEnv ? [parsed.appPasswordEnv] : []),
  ];
  if (new Set(names).size !== names.length)
    throw new Error("Eve proposed the same secret more than once.");
  if (Object.keys(parsed.runtimeEnv).some((key) => names.includes(key)))
    throw new Error("Eve proposed a secret as a public environment value.");
  if (
    Object.keys(parsed.runtimeEnv).some((key) =>
      /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD)$/.test(key),
    )
  )
    throw new Error("Eve proposed a credential as a public environment value.");
  if (
    [...names, ...Object.keys(parsed.runtimeEnv)].some((key) =>
      /^(?:FLY_|KODY_|APP_)/.test(key),
    )
  )
    throw new Error("Eve proposed a reserved Fly Hub environment name.");
  return parsed;
}
