import { z } from "zod";

const envName = z.string().regex(/^[A-Z_][A-Z0-9_]{0,99}$/);

export const taskBuildSchema = z
  .object({
    rootDirectory: z
      .string()
      .regex(/^(?:\.|[\w.-]+(?:\/[\w.-]+)*)$/)
      .max(200)
      .refine((value) => !value.split("/").includes(".."))
      .default("."),
    dockerfileContent: z.string().min(1).max(16_384).optional(),
    startCommand: z.string().trim().min(1).max(500).optional(),
    port: z.number().int().min(1).max(65_535),
    storagePath: z
      .string()
      .startsWith("/")
      .max(200)
      .refine((value) => !value.split("/").includes(".."))
      .optional(),
    runtimeEnv: z.record(envName, z.string().max(500)).default({}),
    generatedSecrets: z.array(envName).max(20).default([]),
    appPasswordEnv: envName.optional(),
    verificationPath: z
      .string()
      .regex(/^\/[\w./?=&%-]*$/)
      .max(200)
      .default("/"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const names = [
      ...value.generatedSecrets,
      ...(value.appPasswordEnv ? [value.appPasswordEnv] : []),
    ];
    if (new Set(names).size !== names.length)
      ctx.addIssue({
        code: "custom",
        message: "Each generated secret needs a unique name.",
      });
    if (
      Object.keys(value.runtimeEnv).some(
        (key) =>
          names.includes(key) ||
          /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD)$/.test(key),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Do not put credentials in runtimeEnv.",
      });
    if (
      [...names, ...Object.keys(value.runtimeEnv)].some((key) =>
        /^(?:FLY_|KODY_|APP_)/.test(key),
      )
    )
      ctx.addIssue({ code: "custom", message: "Reserved environment name." });
  });

export type FlyHubTaskBuild = z.infer<typeof taskBuildSchema>;
