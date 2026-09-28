/**
 * @fileType utility
 * @domain user-state
 * @pattern user-state-core-namespaces
 * @ai-summary The core user-state namespaces shipped by kody: profile,
 *   progress, selections, stats. Brands cannot override these — custom
 *   namespaces come from the tenant's Convex user-state configuration.
 */
import { z } from "zod";
import type { UserStateNamespace } from "../types";

const profileSchema = z
  .object({
    displayName: z.string().trim().max(200).optional(),
    locale: z.string().trim().max(20).optional(),
    avatarUrl: z.string().url().optional(),
    timezone: z.string().trim().max(60).optional(),
  })
  .strict();

const progressSchema = z.record(
  z.string().min(1),
  z.union([z.string().max(500), z.number(), z.boolean()]),
);

const selectionsSchema = z.record(
  z.string().min(1),
  z.union([z.string().max(2000), z.array(z.string().max(2000)).max(100)]),
);

const statsSchema = z.record(z.string().min(1), z.number());

export const CORE_USER_STATE_NAMESPACES: readonly UserStateNamespace[] = [
  {
    name: "profile",
    version: 1,
    origin: "core",
    schema: profileSchema,
    adapter: "convex",
    merge: "shallow-merge",
    modelWritable: false,
  },
  {
    name: "progress",
    version: 1,
    origin: "core",
    schema: progressSchema,
    adapter: "convex",
    merge: "shallow-merge",
    modelWritable: true,
  },
  {
    name: "selections",
    version: 1,
    origin: "core",
    schema: selectionsSchema,
    adapter: "convex",
    merge: "shallow-merge",
    modelWritable: true,
  },
  {
    name: "stats",
    version: 1,
    origin: "core",
    schema: statsSchema,
    adapter: "convex",
    merge: "shallow-merge",
    modelWritable: true,
  },
];
