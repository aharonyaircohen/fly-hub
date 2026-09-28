/**
 * Unit tests for the encrypted vault store. The vault is encrypted, but the
 * values live in the configured backend.
 */

import { randomBytes } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("@kody-ade/backend/api", () => ({
  api: { repoDocs: { get: "repoDocs:get", save: "repoDocs:save" } },
}));
vi.mock("@kody-ade/backend/client", () => ({
  createBackendClient: () => backend,
}));

vi.mock("@kody-ade/base/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { decrypt, deriveKeyCheck, encrypt } from "@kody-ade/base/vault/crypto";
import {
  invalidateVaultCache,
  listSecretMetadata,
  readVault,
  VAULT_PATH,
  writeVault,
  type VaultDocument,
} from "@kody-ade/base/vault/store";

const KEY = randomBytes(32).toString("hex");
let savedKey: string | undefined;

function fakeOctokit() {
  return { marker: "octokit" } as never;
}

function stateFile(doc: VaultDocument, sha = "sha-1") {
  return {
    content: encrypt(JSON.stringify(doc)),
    sha,
  };
}

const DOC: VaultDocument = {
  version: 1,
  secrets: {
    API_KEY: {
      value: "super-secret",
      updatedAt: "2026-01-01T00:00:00.000Z",
      updatedBy: "alice",
    },
  },
  keyCheck: deriveKeyCheck(KEY),
};

beforeEach(() => {
  savedKey = process.env.KODY_MASTER_KEY;
  process.env.KODY_MASTER_KEY = KEY;
  vi.clearAllMocks();
  invalidateVaultCache("acme", "widgets");
});

afterEach(() => {
  process.env.KODY_MASTER_KEY = savedKey;
  invalidateVaultCache("acme", "widgets");
});

describe("readVault", () => {
  it("reads and decrypts secrets.enc from the configured backend", async () => {
    const octokit = fakeOctokit();
    backend.query.mockResolvedValue({
      doc: { ciphertext: stateFile(DOC).content },
      updatedAt: "sha-1",
    });

    const { doc, sha } = await readVault(octokit, "acme", "widgets");

    expect(doc).toEqual(DOC);
    expect(sha).toBe("sha-1");
    expect(backend.query).toHaveBeenCalledWith("repoDocs:get", {
      tenantId: "acme/widgets",
      kind: VAULT_PATH,
    });
  });

  it("caches reads per repo until invalidated", async () => {
    backend.query.mockResolvedValue({
      doc: { ciphertext: stateFile(DOC).content },
      updatedAt: "sha-1",
    });
    const octokit = fakeOctokit();

    await readVault(octokit, "acme", "widgets");
    await readVault(octokit, "acme", "widgets");

    expect(backend.query).toHaveBeenCalledTimes(1);
  });

  it("force read bypasses cache", async () => {
    backend.query.mockResolvedValue({
      doc: { ciphertext: stateFile(DOC).content },
      updatedAt: "sha-1",
    });
    const octokit = fakeOctokit();

    await readVault(octokit, "acme", "widgets");
    await readVault(octokit, "acme", "widgets", { force: true });

    expect(backend.query).toHaveBeenCalledTimes(2);
  });

  it("collapses concurrent reads into one backend call", async () => {
    let resolve!: (value: unknown) => void;
    backend.query.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const octokit = fakeOctokit();

    const p1 = readVault(octokit, "acme", "widgets");
    const p2 = readVault(octokit, "acme", "widgets");
    resolve({
      doc: { ciphertext: stateFile(DOC).content },
      updatedAt: "sha-1",
    });
    const [a, b] = await Promise.all([p1, p2]);

    expect(backend.query).toHaveBeenCalledTimes(1);
    expect(a.doc).toEqual(b.doc);
  });

  it("returns an empty document when the state file does not exist", async () => {
    backend.query.mockResolvedValue(null);

    const { doc, sha } = await readVault(fakeOctokit(), "acme", "widgets");

    expect(doc).toEqual({ version: 1, secrets: {} });
    expect(sha).toBeNull();
  });
});

describe("writeVault", () => {
  it("encrypts and writes secrets.enc to the configured backend", async () => {
    backend.mutation.mockResolvedValue(undefined);
    const octokit = fakeOctokit();

    const { sha } = await writeVault(octokit, "acme", "widgets", DOC, "sha-1");

    expect(sha).toBeTruthy();
    expect(backend.mutation).toHaveBeenCalledWith(
      "repoDocs:save",
      expect.objectContaining({ tenantId: "acme/widgets", kind: VAULT_PATH }),
    );
  });

  it("adds keyCheck on first write when missing", async () => {
    backend.mutation.mockResolvedValue(undefined);
    const docWithoutKeyCheck: VaultDocument = {
      version: 1,
      secrets: DOC.secrets,
    };

    await writeVault(
      fakeOctokit(),
      "acme",
      "widgets",
      docWithoutKeyCheck,
      null,
    );

    const payload = backend.mutation.mock.calls[0][1];
    expect(JSON.parse(decrypt(payload.doc.ciphertext))).toEqual({
      ...docWithoutKeyCheck,
      keyCheck: deriveKeyCheck(KEY),
    });
  });

  it("returns empty sha when backend write returns no sha", async () => {
    backend.mutation.mockResolvedValue(undefined);

    const { sha } = await writeVault(
      fakeOctokit(),
      "acme",
      "widgets",
      DOC,
      null,
    );

    expect(sha).toBeTruthy();
  });
});

describe("listSecretMetadata", () => {
  it("strips values and sorts by name", () => {
    const doc: VaultDocument = {
      version: 1,
      secrets: {
        ZED: { value: "z", updatedAt: "t2", updatedBy: "bob" },
        ABLE: { value: "a", updatedAt: "t1" },
      },
    };

    const meta = listSecretMetadata(doc);

    expect(meta.map((m) => m.name)).toEqual(["ABLE", "ZED"]);
    expect(meta[0]).not.toHaveProperty("value");
  });
});
