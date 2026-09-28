import { v } from "convex/values";

export const agencyRunSubjectTypeValidator = v.union(
  v.literal("loop"),
  v.literal("workflow"),
  v.literal("capability"),
);

// Keep historical Goal runs readable without reopening Goal as a writable
// Agency subject type.
export const storedAgencyRunSubjectTypeValidator = v.union(
  agencyRunSubjectTypeValidator,
  v.literal("goal"),
);
