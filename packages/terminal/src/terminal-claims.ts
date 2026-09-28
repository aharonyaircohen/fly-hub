/**
 * One trusted validation body for the server and the separately deployed gateway.
 * Keep this literal stable across bundlers: Function.toString() changes under
 * minification and would force needless gateway replacements between environments.
 * No caller-supplied text is compiled.
 */
export const TERMINAL_CLAIMS_VALIDATION_SCRIPT = String.raw`
  if (claims.sub !== "kody-terminal")
    throw new Error("terminal token subject invalid");
  if (!Number.isFinite(claims.exp) || claims.exp <= now)
    throw new Error("terminal token expired");
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(claims.app ?? "")))
    throw new Error("terminal token app invalid");
  if (
    (claims.localExec !== true || claims.machineId !== undefined) &&
    !/^[A-Za-z0-9_-]{1,120}$/.test(String(claims.machineId ?? ""))
  )
    throw new Error("terminal token machine invalid");
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(String(claims.owner ?? "")))
    throw new Error("terminal token owner invalid");
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(String(claims.repo ?? "")))
    throw new Error("terminal token repo invalid");
  if (
    claims.localExec !== true &&
    (typeof claims.chatSessionId !== "string" ||
      !claims.chatSessionId ||
      claims.chatSessionId.length > 240)
  ) {
    throw new Error("terminal token session invalid");
  }
  if (
    claims.conversationId !== undefined &&
    (typeof claims.conversationId !== "string" ||
      !claims.conversationId ||
      claims.conversationId.length > 240)
  ) {
    throw new Error("terminal token conversation invalid");
  }
  if (
    claims.afterRevision !== undefined &&
    (!Number.isInteger(claims.afterRevision) ||
      claims.afterRevision < 0)
  ) {
    throw new Error("terminal token revision invalid");
  }
  if (typeof claims.flyToken !== "string" || !claims.flyToken.trim())
    throw new Error("terminal token credential invalid");
  if (claims.localExec !== undefined && typeof claims.localExec !== "boolean")
    throw new Error("terminal token operation invalid");
`;

export const validateTerminalClaims = new Function(
  "claims", "now", TERMINAL_CLAIMS_VALIDATION_SCRIPT,
) as (claims: Record<string, unknown>, now: number) => void;
