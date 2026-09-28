/**
 * @fileType utility
 * @domain brain
 * @pattern brain-image-runtime-restore
 *
 * Restore-side helpers for saved Brain images.
 *
 * Durable state points at GHCR. Fly gets a per-app registry copy only as a
 * runtime cache so private full Brain images do not need to be public.
 */

import { isValidBrainImageRef } from "./store";
import {
  BRAIN_IMAGE_JOB_OUTPUT_BYTES,
  brainImageJobTimeoutMs,
} from "./image-timeouts";
import { ensureServerProviderTerminalBridge } from "@kody-ade/fly/infrastructure/server-terminal";
import { runTerminalBridgeLocalExec } from "@kody-ade/terminal/bridge-exec-client";
import { mintTerminalBridgeToken } from "@kody-ade/terminal/terminal-token";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function dockerNamePart(value: string, field: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(normalized)) {
    throw new Error(`Invalid Brain image ${field}`);
  }
  return normalized;
}

function imageTag(imageRef: string): string {
  const withoutDigest = imageRef.split("@")[0] ?? imageRef;
  const marker = withoutDigest.lastIndexOf(":");
  if (marker === -1) throw new Error("Invalid Brain image tag");
  const tag = withoutDigest.slice(marker + 1);
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag)) {
    throw new Error("Invalid Brain image tag");
  }
  return tag;
}

export function brainGhcrAuth(input: {
  allSecrets: Record<string, string>;
  githubToken: string;
  account: string;
}): { token: string; user: string } {
  return {
    token:
      input.githubToken.trim() || input.allSecrets.GITHUB_TOKEN?.trim() || "",
    user: input.account,
  };
}

export function brainFlyRuntimeImageRef(input: {
  app: string;
  imageRef: string;
}): string {
  const app = dockerNamePart(input.app, "app");
  return `registry.fly.io/${app}:${imageTag(input.imageRef)}`;
}

export function brainImageRestoreCommand(input: {
  sourceImageRef: string;
  runtimeImageRef: string;
  ghcrUser: string;
}): string {
  if (!isValidBrainImageRef(input.sourceImageRef)) {
    throw new Error("Invalid Brain GHCR image ref");
  }
  if (
    !/^registry\.fly\.io\/[a-z0-9][a-z0-9._-]*:[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(
      input.runtimeImageRef,
    )
  ) {
    throw new Error("Invalid Brain runtime image ref");
  }
  const ghcrUser = dockerNamePart(input.ghcrUser, "GHCR user");
  return String.raw`/bin/bash -lc ${shellQuote(`
set -euo pipefail
source_image=${shellQuote(input.sourceImageRef)}
runtime_image=${shellQuote(input.runtimeImageRef)}
ghcr_user=${shellQuote(ghcrUser)}
tmpdir="$(mktemp -d)"
export DOCKER_CONFIG="$tmpdir/docker"
export REGISTRY_AUTH_FILE="$tmpdir/registry-auth.json"
install -d -m 0700 "$DOCKER_CONFIG"
trap 'rm -rf "$tmpdir"' EXIT

if ! command -v skopeo >/dev/null 2>&1; then
  apt-get update >/dev/null
  apt-get install -y --no-install-recommends skopeo ca-certificates >/dev/null
  rm -rf /var/lib/apt/lists/*
fi

if [ -z "\${GHCR_TOKEN:-}" ]; then
  echo "GitHub PAT missing; reconnect GitHub with package read and write permission" >&2
  exit 1
fi

node -e ${shellQuote(`const tokens = (process.env.FLY_API_TOKEN || "").trim().replace(/^(?:FlyV1|Bearer)\\s+/i, "").split(",").map(t => t.trim()).filter(Boolean); const macaroons = tokens.filter(t => /^(?:fm1r|fm1a|fm2)_/.test(t)); process.stdout.write((macaroons.length ? macaroons : tokens).join(","));`)} | skopeo login registry.fly.io --username x --password-stdin >/dev/null
printf '%s' "$GHCR_TOKEN" | skopeo login ghcr.io --username "$ghcr_user" --password-stdin >/dev/null

attempt=1
while ! skopeo copy --all --authfile "$REGISTRY_AUTH_FILE" "docker://$source_image" "docker://$runtime_image" > "$tmpdir/copy.log" 2>&1; do
  if grep -Eiq 'unauthorized|authentication required|access.*denied|forbidden' "$tmpdir/copy.log"; then
    echo "Image registry access was denied. Check your GitHub and Fly credentials. The current Brain was not replaced." >&2
    exit 1
  fi
  if ! grep -Eiq 'unexpected EOF|connection reset|connection refused|timed out|timeout|TLS handshake|temporary failure|status code: (429|50[234])' "$tmpdir/copy.log"; then
    echo "Could not prepare the saved image. The current Brain was not replaced." >&2
    exit 1
  fi
  if [ "$attempt" -ge 3 ]; then
    echo "Image upload was interrupted after 3 attempts. The current Brain was not replaced. Try running the image again." >&2
    exit 1
  fi
  echo "__KODY_BRAIN_RESTORE_RETRY=$attempt"
  sleep $((attempt * 2))
  attempt=$((attempt + 1))
done

printf '\\n__KODY_BRAIN_RUNTIME_IMAGE_REF=%s\\n' "$runtime_image"
`)}`;
}

export async function prepareBrainRuntimeImage(input: {
  owner: string;
  repo: string;
  app: string;
  imageRef: string;
  runtimeImageRef?: string;
  flyToken: string;
  ghcrToken: string;
  ghcrUser: string;
  orgSlug: string;
  defaultRegion: string;
}): Promise<string> {
  const runtimeImageRef =
    input.runtimeImageRef ??
    brainFlyRuntimeImageRef({
      app: input.app,
      imageRef: input.imageRef,
    });
  const bridge = await ensureServerProviderTerminalBridge({
    token: input.flyToken,
    orgSlug: input.orgSlug,
    defaultRegion: input.defaultRegion,
  });
  const token = mintTerminalBridgeToken({
    owner: input.owner,
    repo: input.repo,
    app: input.app,
    orgSlug: input.orgSlug,
    flyToken: input.flyToken,
    ghcrToken: input.ghcrToken,
    localExec: true,
    ttlSeconds: 900,
    secret: bridge.secret,
  });
  const result = await runTerminalBridgeLocalExec({
    bridgeUrl: bridge.url,
    token,
    command: brainImageRestoreCommand({
      sourceImageRef: input.imageRef,
      runtimeImageRef,
      ghcrUser: input.ghcrUser,
    }),
    timeoutMs: brainImageJobTimeoutMs(),
    maxOutputBytes: BRAIN_IMAGE_JOB_OUTPUT_BYTES,
  });
  const match = result.stdout.match(
    /__KODY_BRAIN_RUNTIME_IMAGE_REF=(registry\.fly\.io\/[^\s]+)/,
  );
  if (!match?.[1]) {
    throw new Error("Brain image restore finished without a runtime image ref");
  }
  if (match[1] !== runtimeImageRef) {
    throw new Error("Brain image restore returned an unexpected runtime ref");
  }
  return runtimeImageRef;
}
