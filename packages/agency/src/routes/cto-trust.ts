/**
 * @fileType api-endpoint
 * @domain kody
 * @pattern capability-trust-management
 * @ai-summary GET/POST /api/kody/cto/trust — read + management surface for the
 *   capability-keyed trust ledger, stored as a JSON file in the configured Kody backend
 *   (`state/trust.json`), NOT an issue. Powers the /trust page.
 *
 *   GET  → the full per-capability trust stats (`capabilities[slug]`) + recent log.
 *   POST → an operator override of one capability's autonomy:
 *            { capability, op: "reset" | "graduate" | "degrade" }
 *          Applies the matching pure transform from `trust-state` through the
 *          file CAS mutator, records an audit entry, returns the new stats.
 *
 *   This never posts an `@kody` command — it only rewrites trust state.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  verifyRepoReadAccess,
  verifyRepoWriteAccess,
  verifyActorLogin,
  getRequestAuth,
} from "@kody-ade/base/auth";
import { setGitHubContext, clearGitHubContext } from "../github";
import { readTrust, mutateTrust } from "../cto/trust-store";
import {
  applySubjectTrustOp,
  applySubjectTrustLevel,
  applyCapabilityTrustLevel,
  applyCapabilityNeverAuto,
  applyTrustOp,
  isTrustSubjectKey,
  TRUST_LEVELS,
  TRUST_OPS,
} from "../cto/trust-state";
import { recordAudit } from "@kody-ade/base/activity/audit";

const bodySchema = z
  .object({
    capability: z
      .string()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9][a-z0-9-]*$/i)
      .optional(),
    subject: z.string().refine(isTrustSubjectKey).optional(),
    op: z.enum(TRUST_OPS).optional(),
    level: z.enum(TRUST_LEVELS).optional(),
    neverAuto: z.boolean().optional(),
    actorLogin: z.string().optional(),
  })
  .refine((body) => Boolean(body.capability) !== Boolean(body.subject), {
    message: "Provide exactly one of capability or subject",
    path: ["capability"],
  })
  .refine(
    (body) =>
      [body.op, body.level, body.neverAuto].filter(
        (value) => value !== undefined,
      ).length === 1,
    {
      message: "Provide exactly one of op, level, or neverAuto",
      path: ["op"],
    },
  )
  .refine((body) => body.neverAuto === undefined || Boolean(body.capability), {
    message: "neverAuto applies to a capability",
    path: ["neverAuto"],
  });

/** GET — full capability trust stats + recent log for the /trust page. */
export async function GET(req: NextRequest) {
  const authResult = await verifyRepoReadAccess(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);
  try {
    const manifest = await readTrust();
    return NextResponse.json({
      capabilities: manifest.capabilities,
      subjects: manifest.subjects,
      log: manifest.log,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "read failed";
    return NextResponse.json(
      { error: "trust_read_failed", message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}

/** POST — apply one trust override (reset / graduate / degrade) to a capability. */
export async function POST(req: NextRequest) {
  const authResult = await verifyRepoWriteAccess(req);
  if (authResult instanceof NextResponse) return authResult;

  const headerAuth = getRequestAuth(req);
  if (!headerAuth) {
    return NextResponse.json({ error: "no_repo_context" }, { status: 400 });
  }
  setGitHubContext(headerAuth.owner, headerAuth.repo, headerAuth.token);

  try {
    let payload: z.infer<typeof bodySchema>;
    try {
      payload = bodySchema.parse(await req.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json(
          { error: "validation_error", details: err.issues },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: "bad_json" }, { status: 400 });
    }

    const { capability, subject, op, level, neverAuto, actorLogin } = payload;

    if (actorLogin) {
      const actorResult = await verifyActorLogin(req, actorLogin);
      if (actorResult instanceof NextResponse) return actorResult;
    }

    const manifest = await mutateTrust((current) => {
      if (neverAuto !== undefined) {
        return applyCapabilityNeverAuto(current, capability!, neverAuto);
      }
      if (level) {
        return capability
          ? applyCapabilityTrustLevel(current, capability, level)
          : applySubjectTrustLevel(current, subject!, level);
      }
      if (capability && op === "earn") {
        // Earn resumes the default path — clear the capability entry AND its
        // subject-side pin so nothing keeps overriding the earned streak.
        return applySubjectTrustOp(
          applyTrustOp(current, op, capability),
          op,
          `capability:${capability}` as const,
        );
      }
      return capability
        ? applyTrustOp(current, op!, capability)
        : applySubjectTrustOp(current, op!, subject!);
    });
    const target = capability ?? subject!;
    const action =
      neverAuto !== undefined
        ? `trust.neverAuto.${neverAuto ? "on" : "off"}`
        : level
          ? `trust.set.${level}`
          : `trust.${op}`;

    recordAudit(req, {
      action,
      resource: target,
      ...(capability ? { capability } : {}),
      detail:
        neverAuto !== undefined
          ? `neverAuto=${neverAuto} for ${target}`
          : `${level ?? op} trust for ${target}`,
    });

    return NextResponse.json({
      ok: true,
      ...(capability ? { capability } : { subject }),
      ...(neverAuto !== undefined ? { neverAuto } : op ? { op } : { level }),
      stats: capability
        ? (manifest.capabilities[capability] ?? null)
        : (manifest.subjects[subject!] ?? null),
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to update trust";
    console.error("[cto/trust] failed", err);
    return NextResponse.json(
      { error: "trust_update_failed", message },
      { status: 500 },
    );
  } finally {
    clearGitHubContext();
  }
}
