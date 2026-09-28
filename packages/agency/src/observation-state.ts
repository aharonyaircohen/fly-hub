/** Durable evidence written by observer loops before it becomes a Report. */
import { z } from "zod";

const IdSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
const TimestampSchema = z.string().datetime({ offset: true });
const ShortTextSchema = z.string().trim().min(1).max(500);

export const ObservationEvidenceSchema = z
  .object({
    kind: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(300),
    status: z.string().trim().min(1).max(80).optional(),
    url: z.string().url().max(2_000).optional(),
    value: z.union([z.string().max(2_000), z.number(), z.boolean()]).optional(),
  })
  .strict();

export const ObservationSchema = z
  .object({
    version: z.literal(1),
    id: IdSchema,
    observerId: IdSchema,
    capability: IdSchema,
    subject: IdSchema,
    status: z.enum(["healthy", "unhealthy", "unknown"]),
    summary: ShortTextSchema,
    evidence: z.array(ObservationEvidenceSchema).max(100).default([]),
    observedAt: TimestampSchema,
    expiresAt: TimestampSchema.optional(),
  })
  .strict();

export type Observation = z.infer<typeof ObservationSchema>;
