# Secrets vault

The dashboard ships with a per-repo encrypted vault you can use instead
of pasting API keys into Vercel environment variables. Secrets are
stored as the repository-scoped `secrets.enc` document in Convex,
AES-256-GCM-encrypted with a shared server key (`KODY_MASTER_KEY`)
that lives only in Vercel env. Runtime code reads them at request
time via the `getSecret()` helper, falling back to `process.env`
when the vault is empty or unconfigured.

This is a pragmatic, single-file vault — the right shape for a
small/team dashboard. It is **not** a replacement for a managed
secret store (Vault, Doppler, AWS Secrets Manager) if you have
compliance requirements or many users. See **Threat model** below
for the tradeoffs.

## When to use the vault

Use the vault for:

- **Dashboard-runtime API keys**: Gemini, Jina, OpenAI, Anthropic,
  OpenAI, Anthropic, third-party REST tokens — anything the Vercel
  function reads at request time.
- **Per-repo segregation**: each connected repo has its own vault
  file, so different projects can hold different keys.
- **Editable secrets without redeploys**: change a value on the
  `/secrets` page and the next request picks it up (60s cache TTL).

The same vault supplies Engine runtime secrets. A `kody.yml` run authenticates
with GitHub OIDC, and Engine requests only the secret names declared by its
capability. User secrets are not mirrored into GitHub Actions.

Do **not** use the vault for:

- **The master secret itself** (`KODY_MASTER_KEY`) — must stay in
  Vercel env, because it's what unlocks the vault. Plus the
  server-side `GITHUB_TOKEN` for cron/webhook flows. That's the entire
  required-env surface.

## One-time setup

The vault needs one server-side secret (`KODY_MASTER_KEY`). This is
the only manual step.

1. **Generate the key locally**

   ```bash
   pnpm vault:init
   ```

   The script prints a fresh 32-byte key in hex:

   ```
   KODY_MASTER_KEY=<64 hex characters>
   ```

2. **Add it to Vercel**
   - Vercel project → **Settings** → **Environment Variables**
   - Add `KODY_MASTER_KEY` with the value, scoped to **Production**
     and **Preview** (both).

3. **Save it in your team's password manager**

   1Password, Bitwarden, etc. The key is required to decrypt every
   repository vault — keep a copy outside Vercel for recovery.

4. **Redeploy** (any push or `vercel --prod`) so the new env var is
   picked up by running functions.

That's it. The `/secrets` page now works for every team member who
logs into the dashboard.

## Using the vault

### Storing a secret

1. Open `/secrets` (key icon in the dashboard header).
2. Click **New secret**.
3. Enter a name (uppercase letters, digits, underscores; e.g.
   `GEMINI_API_KEY`) and the value.
4. **Save**.

The dashboard:

- Encrypts the new map with `KODY_MASTER_KEY`.
- Saves the encrypted `secrets.enc` document under the active repository's
  Convex tenant.
- Invalidates the in-memory cache. Next read sees the new value.

### Editing a secret

Click **Edit** on the row and paste a new value. Existing values are
never displayed — every save overwrites.

### Deleting a secret

Click **Delete**. The entry is removed from the JSON map; runtime
calls fall back to `process.env`.

### Reading a secret in code

Replace `process.env.X` with `await getSecret("X", { req })`:

```typescript
import { getSecret } from "../src/dashboard/lib/vault/get-secret";

export async function POST(req: NextRequest) {
  const apiKey = await getSecret("GEMINI_API_KEY", { req });
  if (!apiKey) {
    return NextResponse.json({ error: "no_api_key" }, { status: 503 });
  }
  // … use apiKey
}
```

The helper:

- Returns the vault value if `KODY_MASTER_KEY` is set, the request
  has auth headers, and the secret exists.
- Falls back to `process.env[name]` otherwise.
- Caches per-repo for 60s with in-flight dedup so polling endpoints
  don't stampede Convex.

## How it works

```
┌─────────────────────────┐    write     ┌────────────────────────┐
│ /secrets page (browser) │─────────────▶│ /api/kody/secrets      │
└─────────────────────────┘              │  POST { name, value }  │
                                         └─────────┬──────────────┘
                                                   │ encrypt with KODY_MASTER_KEY
                                                   ▼
                                         ┌────────────────────────┐
                                         │ Convex repoDocs        │
                                         │ SAVE secrets.enc       │
                                         └────────────────────────┘

┌────────────────────┐  read   ┌──────────────┐  fetch + decrypt   ┌────────────┐
│ /api/kody/chat/... │────────▶│ getSecret()  │───────────────────▶│ secrets.enc │
└────────────────────┘         └──────────────┘  (60s cache)       └────────────┘
```

- **Encryption**: AES-256-GCM (`crypto` module). Format:
  `v1:<iv_b64>:<ct_b64>:<tag_b64>`.
- **Vault document**: JSON of shape
  `{ version: 1, secrets: { NAME: { value, updatedAt, updatedBy } } }`,
  encrypted before it is saved under the repository's Convex tenant.
- **Cache**: per `owner/repo`, 60s TTL, in-flight dedup. Writes
  invalidate same-instance cache; other instances pick up changes
  within TTL.

## Threat model

| Attacker has…                                      | Can they read your secrets?                     |
| -------------------------------------------------- | ----------------------------------------------- |
| Public internet only                               | No.                                             |
| Repository read access                             | No vault data is stored in the repository.      |
| Convex data read access                            | No — stored vault documents are encrypted.      |
| Valid Kody workflow identity for the repository    | Yes, through the repository-scoped runtime API. |
| Dashboard runtime or master key plus Convex access | Yes.                                            |

GitHub repository writers can modify and run workflows, so treat them as able
to access that repository's runtime secrets. This matches GitHub Actions'
standard trust model.

**What the vault does NOT protect against**:

- A team member with vault access exfiltrating values through the
  `/secrets` UI. Standard insider risk — control via GitHub repo
  permissions and Vercel project access.
- A compromised dashboard process. The Vercel function holds plaintext
  in memory while serving a request. If the runtime is compromised,
  so are your secrets.

## Rotation

### Rotating an individual secret

Just update it on the `/secrets` page. The new ciphertext replaces
the old; the next request reads the new value.

### Rotating `KODY_MASTER_KEY`

Treat as a destructive operation — the entire vault becomes
unreadable.

1. Export current values manually (you cannot decrypt later without
   the old key). Use a temporary scratch store.
2. Generate a new key (`pnpm vault:init`).
3. Update `KODY_MASTER_KEY` in Vercel env.
4. Redeploy.
5. Re-enter every secret on the `/secrets` page.

### What if I lose `KODY_MASTER_KEY`?

The vault is unrecoverable. But: the values are third-party API
keys, not unique data. Reissue each one (Google AI Studio, Jina,
etc.), generate a new vault key, re-enter values. Annoying but not
catastrophic — usually ~10 minutes of work.

## Migration from Vercel env vars

You can move secrets gradually. `getSecret()` reads the vault first
and falls back to `process.env`, so the same code works in both
states.

Recommended order:

1. Add the secret to the vault via `/secrets`.
2. Verify the dashboard still works (the vault now wins).
3. Remove the env var from Vercel → Settings → Environment Variables.
4. Repeat for the next secret.

Already cut over: `GEMINI_API_KEY` (read by
`/api/kody/chat/kody`).

## File reference

| File                                    | Purpose                                            |
| --------------------------------------- | -------------------------------------------------- |
| `packages/base/src/vault/crypto.ts`     | AES-256-GCM encryption and master-key loading      |
| `packages/base/src/vault/store.ts`      | Convex-backed encrypted document storage and cache |
| `packages/base/src/vault/get-secret.ts` | Dashboard runtime secret lookup                    |
| `app/api/kody/secrets/route.ts`         | User-authenticated list and upsert                 |
| `app/api/kody/engine/secret/route.ts`   | GitHub OIDC-authenticated Engine lookup            |

## FAQ

**Can the same vault be used by multiple connected repos?**

No. Each connected repo has its own `secrets.enc` document. If you want
shared secrets across repos, store them in Vercel env vars (which is
the default fallback) or duplicate them per repo.

**How does Engine use the vault without the master key?**

GitHub issues the running `kody.yml` workflow a short-lived OIDC identity.
Dashboard verifies that identity, decrypts the matching repository vault on
the server, and returns only the requested secret. `KODY_MASTER_KEY` never
leaves Dashboard.

**Which credentials power Chat and Engine?**

Chat resolves a credential from the active repository first, then from the
signed-in user's Personal Credentials. GitHub Engine runs use only the
repository vault because a workflow has repository identity, not a Kody user
session. During `/init`, Kody copies any missing credential required by the
selected Engine model from the signed-in user's Personal Credentials into the
repository vault. An existing Repository Secret always wins and is never
overwritten by this provisioning step.

**Can I see the values after I save them?**

No. The `/secrets` page shows names and last-modified timestamps
only. To verify a value, set it again — saves overwrite.

**What happens during deploys?**

Reads pass through the cache and writes update Convex. New deployments start
with an empty in-memory cache and warm it on the first request per repository.

**How do I revoke a team member?**

Remove their Dashboard and GitHub repository access. Repository writers must
be treated as trusted because they can modify and run `kody.yml`.
