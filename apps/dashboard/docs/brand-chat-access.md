# Brand Chat access

Brand Chat consumes identity; it does not provide login.

## Ownership

- The brand record owns presentation, chat defaults, and one explicit access
  mode: `public` or `delegated`.
- The host application owns user login.
- The repository owns its trusted external issuer configuration.
- Brand Chat verifies identity, creates its own HttpOnly session, and enforces
  the tenant and brand scope on every protected surface.
- Convex owns brand state and one-time launch replay protection.

## Dashboard launch

The Brands page calls `POST /api/client-session/dashboard-launch` with the
existing authenticated Dashboard headers. The server verifies the PAT owner,
creates the scoped Brand Chat session cookie, and returns the client route.
Credentials and session tokens are never placed in the URL.

## GuidedFlow learning

Authenticated Brand Chat users can start, read, and resume GuidedFlows saved
for the exact repository tenant. Their flow position is scoped to that tenant
and to the identity supplied by the Dashboard or external host.

Brand Chat is a learner surface: it cannot create, edit, or delete GuidedFlow
definitions, and it does not receive repository administration or GitHub
tools. Authors create and manage flows from the repository-scoped Dashboard or
Kody chat; learners run those flows through Brand Chat.

## External host launch

The host submits a short-lived signed assertion as a browser form POST to
`/api/client-session/external-launch`. Kody verifies it, creates a 30-minute
scoped session, and returns a `303` redirect to the brand route.

```html
<form
  method="post"
  action="https://dashboard.example/api/client-session/external-launch"
>
  <input type="hidden" name="assertion" value="JWT" />
  <input type="hidden" name="owner" value="owner" />
  <input type="hidden" name="repo" value="repo" />
  <input type="hidden" name="brandSlug" value="brand" />
</form>
```

Required JWT claims:

- `sub`: stable host user id
- `aud`: configured audience
- `iss`: configured issuer
- `iat` and `exp`: maximum five-minute launch lifetime
- `jti`: unique one-time token id
- `tenant_id`: exact `owner/repo`
- `brand_slug`: exact brand slug

Repository variables configure trust:

- `CLIENT_IDENTITY_ISSUER`
- `CLIENT_IDENTITY_AUDIENCE`
- `CLIENT_IDENTITY_JWKS_URL`

Add these as plaintext settings on Kody's repository-scoped **Variables** page,
not as GitHub Actions repository variables. The issuer and JWKS URL must share
an HTTPS origin. A matching `http://localhost`, `http://127.0.0.1`, or
`http://[::1]` origin is accepted only while the Kody Dashboard runs in local
development mode.

Issuer and JWKS must use the same HTTPS origin. Supported algorithms are
RS256, ES256, and EdDSA. A valid assertion is exchanged for the same internal
session used by Dashboard launch; the assertion cannot be replayed. The host
should send only the opaque user id in `sub`; Kody ignores profile claims and
stores only a one-way issuer-scoped hash of that id.

## Failure behavior

- Repository state failures never fall back to public access.
- Missing or invalid delegated identity never opens Chat.
- A session for another repository or brand is rejected.
- Public access is explicit and does not depend on missing configuration.
