import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1);
const GenerationSchema = z.number().int().positive();
const RevisionSchema = z.number().int().nonnegative();

export const TerminalSessionStateSchema = z.enum([
  "starting",
  "ready",
  "detached",
  "exited",
  "failed",
]);

export type TerminalSessionState = z.infer<typeof TerminalSessionStateSchema>;
export type TerminalSessionId = string;

export const TerminalSessionInputSchema = z.object({
  id: IdentifierSchema,
  scope: z.object({
    owner: IdentifierSchema,
    repo: IdentifierSchema,
    conversationId: IdentifierSchema,
  }),
  target: z.object({
    kind: z.literal("brain"),
    runtimeId: IdentifierSchema,
  }),
});

export type TerminalSessionInput = z.infer<typeof TerminalSessionInputSchema>;

export const TerminalSessionSchema = TerminalSessionInputSchema.extend({
  generation: GenerationSchema,
  state: TerminalSessionStateSchema,
  revision: RevisionSchema,
});

export type TerminalSession = z.infer<typeof TerminalSessionSchema>;

export const TerminalCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("attach"),
    sessionId: IdentifierSchema,
    afterRevision: RevisionSchema.optional(),
  }),
  z.object({
    type: z.literal("input"),
    sessionId: IdentifierSchema,
    inputId: IdentifierSchema,
    data: z.string().min(1),
  }),
  z.object({
    type: z.literal("resize"),
    sessionId: IdentifierSchema,
    cols: z.number().int().min(1).max(1_000),
    rows: z.number().int().min(1).max(1_000),
  }),
  z.object({
    type: z.literal("detach"),
    sessionId: IdentifierSchema,
  }),
  z.object({
    type: z.literal("clear"),
    sessionId: IdentifierSchema,
  }),
  z.object({
    type: z.literal("restart"),
    sessionId: IdentifierSchema,
  }),
]);

export type TerminalCommand = z.infer<typeof TerminalCommandSchema>;

const TerminalEventIdentitySchema = z.object({
  sessionId: IdentifierSchema,
  generation: GenerationSchema,
});

export const TerminalEventSchema = z.discriminatedUnion("type", [
  TerminalEventIdentitySchema.extend({
    type: z.literal("state"),
    state: TerminalSessionStateSchema,
  }),
  TerminalEventIdentitySchema.extend({
    type: z.literal("output"),
    revision: GenerationSchema,
    data: z.string(),
  }),
  TerminalEventIdentitySchema.extend({
    type: z.literal("input-accepted"),
    inputId: IdentifierSchema,
  }),
  TerminalEventIdentitySchema.extend({
    type: z.literal("exited"),
    code: z.number().int().optional(),
  }),
  TerminalEventIdentitySchema.extend({
    type: z.literal("failed"),
    code: IdentifierSchema,
    message: IdentifierSchema,
  }),
]);

export type TerminalEvent = z.infer<typeof TerminalEventSchema>;

export type TerminalSessionAction =
  | { type: "command"; command: TerminalCommand }
  | { type: "event"; event: TerminalEvent };
