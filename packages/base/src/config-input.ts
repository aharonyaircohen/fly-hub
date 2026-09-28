import { z } from "zod";

export const ConfigNameSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,127}$/, {
  message:
    "Name must be uppercase letters, digits, underscores; start with a letter; ≤128 chars.",
});

export const ConfigValueSchema = z
  .string()
  .min(1, { message: "Value cannot be empty" })
  .max(64 * 1024);
