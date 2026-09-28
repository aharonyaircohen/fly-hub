/**
 * Classify the durable state of one Brain image apply operation.
 *
 * A Fly machine can remain `running` while its image replacement is still in
 * progress, so machine state alone is never sufficient completion evidence.
 */
export function classifyBrainImageApply(
  state,
  operationId,
  imageRef,
  options = {},
) {
  const operation = state?.runtime?.operation ?? state?.operation;
  if (!operation || operation.id !== operationId) {
    return {
      status: "conflict",
      message: "Brain restore operation was replaced before it completed",
    };
  }
  if (operation.imageRef !== imageRef) {
    return {
      status: "conflict",
      message: "Brain restore operation changed its target image",
    };
  }
  if (operation.status === "failed") {
    return {
      status: "failed",
      message: operation.error || "Brain restore operation failed",
    };
  }
  if (
    operation.status === "running" &&
    options.staleAfterMs &&
    options.nowMs - Date.parse(operation.updatedAt) > options.staleAfterMs
  ) {
    return { status: "stale" };
  }
  if (
    operation.status === "completed" &&
    state.runningImageRef === imageRef &&
    state.runningApp &&
    state.runningMachineId
  ) {
    return { status: "completed" };
  }
  return { status: "running" };
}

export function mergeSessionCookies(cookieHeader, setCookieHeaders) {
  const cookies = new Map();
  for (const pair of String(cookieHeader || "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
  for (const header of setCookieHeaders || []) {
    const pair = String(header).split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (value) cookies.set(name, value);
    else cookies.delete(name);
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function needsApiSessionSignIn({ sessionCookie, email, password }) {
  return !String(sessionCookie || "").trim() && Boolean(email && password);
}

export function activeBrainImageSaveJob(state) {
  const save = state?.save;
  if (!save?.jobId || save.status !== "running") return null;
  return { jobId: save.jobId };
}

/**
 * A save that was already running may have captured the Brain before this
 * verifier wrote its marker. Let it finish, then start a fresh save whose
 * contents are owned by this run.
 */
export function shouldStartFreshBrainImageSave(attachedToExistingSave) {
  return attachedToExistingSave === true;
}

export function brainImageSavePollAction(
  status,
  attachedToExistingSave,
  missingForMs = Number.POSITIVE_INFINITY,
) {
  if (status === "completed") return "completed";
  if (status === "idle") {
    if (attachedToExistingSave) return "drained";
    return missingForMs < 60_000 ? "reconciling" : "missing";
  }
  if (status === "failed") return "failed";
  return "pending";
}

/**
 * Observe long-running lifecycle progress without reloading the mounted app.
 * The Brain Images screen already polls its operation state; full reloads fan
 * out GitHub-backed requests and can exhaust provider limits during a save.
 */
export async function readBrainLifecycleProgress({
  exitError,
  childCompleted,
  readPageText,
}) {
  if (exitError) throw exitError;
  if (childCompleted) return "Brain lifecycle completed";
  return readPageText();
}

export function brainMachineImageAction(input) {
  const clean = (value) => String(value || "").split("@")[0];
  const source = clean(input.runningImageRef);
  const marker = source.lastIndexOf(":");
  const tag = marker === -1 ? "latest" : source.slice(marker + 1);
  const runtime = clean(`registry.fly.io/${input.runningApp}:${tag}`);
  const machine = clean(input.machineImageRef);
  if (machine && (machine === source || machine === runtime)) return "verified";
  return input.allowRebaseline ? "rebaseline" : "mismatch";
}
