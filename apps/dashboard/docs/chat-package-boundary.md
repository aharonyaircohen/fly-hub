# Kody Chat ownership boundary

Current as of 2026-07-22.

## The three layers

| Layer                          | Owns                                                                                                  | Must not own                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/kody-chat`           | Public host-neutral React chat contract and UI                                                        | Dashboard routes, Kody services, Dashboard aliases, private workspace dependencies |
| `packages/kody-chat-dashboard` | Private Kody-specific chat integration, plugins, pages, route handlers, and shared integration source | A standalone Next.js app, deployment shell, or Dashboard navigation host           |
| `apps/dashboard`               | The deployed Next.js host, route mounting, navigation, repository scope, and Dashboard-only features  | Copied implementations of private integration code                                 |

The public package is what an external project installs. The private integration
package connects that public chat surface to Kody. The Dashboard mounts the
private integration and remains the only deployable application.

## Enforced rules

- Dashboard uses declared `@kody-ade/kody-chat-dashboard/*` exports. The old
  `@kody-chat/*` alias is forbidden.
- Dashboard app routes may be thin re-export mounts; their implementations live
  in the private integration package.
- Byte-identical app implementations, source implementations, and test specs may
  not exist in both workspaces.
- Two same-text files intentionally remain local because relative imports bind
  them to different host contracts:
  - `lib/chat-defaults/index.ts` selects each workspace's agent identity.
  - `lib/inbox/useInbox.ts` binds to each workspace's different inbox type.
- Source-text tests may read private package source through its workspace
  symlink. Those reads verify implementation invariants; runtime imports still
  use declared package exports.
- Tailwind scans private package source so classes used by mounted integration
  components are included in the Dashboard build.

These rules are pinned by:

- `tests/unit/chat-package-import-boundary.spec.ts`
- `tests/unit/private-integration-package-shape.spec.ts`
- `tests/unit/private-integration-app-ownership.spec.ts`

## Release boundary

`@kody-ade/kody-chat` is independently buildable and externally installable.
Changes to the private integration or Dashboard do not require a public package
release unless the public package itself changes.

Required proof for public releases:

1. Public package build and typecheck.
2. Clean external registry installation.
3. External-host browser journey.
4. Dashboard repository verification and canonical browser gate when the host
   integration changed.
