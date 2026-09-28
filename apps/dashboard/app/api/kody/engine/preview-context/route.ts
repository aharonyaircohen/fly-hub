import { NextResponse } from "next/server";

import { api as backendApi } from "@kody-ade/backend/api";
import { createBackendClient } from "@kody-ade/backend/client";
import { decrypt } from "@kody-ade/base/vault/crypto";
import type { VaultDocument } from "@kody-ade/base/vault/store";
import { derivePreviewKey } from "@kody-ade/fly/preview-token";
import {
  NEVER_PASS_TO_BUILD,
  parseBuildMode,
} from "@kody-ade/fly/previews/vault-build-context";
import {
  bearerToken,
  verifyGitHubWorkflowIdentity,
} from "@dashboard/lib/backend/github-actions-identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function POST(request: Request) {
  const token = bearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: "missing_workflow_identity" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  let repository: string;
  try {
    repository = (await verifyGitHubWorkflowIdentity(token)).repository;
  } catch {
    return NextResponse.json(
      { error: "invalid_workflow_identity" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  try {
    const record = (await createBackendClient().query(backendApi.repoDocs.get, {
      tenantId: repository,
      kind: "secrets.enc",
    })) as { doc?: { ciphertext?: string } } | null;
    const ciphertext = record?.doc?.ciphertext?.trim();
    if (!ciphertext) {
      return NextResponse.json(
        { error: "vault_not_found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const vault = JSON.parse(decrypt(ciphertext)) as VaultDocument;
    if (vault.version !== 1 || !vault.secrets)
      throw new Error("invalid vault document");

    const buildEnv: Record<string, string> = {};
    for (const [name, entry] of Object.entries(vault.secrets)) {
      if (entry?.value && !NEVER_PASS_TO_BUILD.has(name))
        buildEnv[name] = entry.value;
    }

    return NextResponse.json(
      {
        buildEnv,
        buildMode: parseBuildMode(vault.secrets.KODY_PREVIEW_BUILD_MODE?.value),
        flyApiToken: vault.secrets.FLY_API_TOKEN?.value ?? null,
        flyOrgSlug: vault.secrets.FLY_ORG_SLUG?.value ?? null,
        flyRegion: vault.secrets.FLY_DEFAULT_REGION?.value ?? null,
        namespaceTenantId: vault.secrets.NSC_TENANT_ID?.value ?? null,
        previewVerifyKey: derivePreviewKey().toString("hex"),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("Kody preview context request failed", {
      repository,
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "preview_context_failed" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
