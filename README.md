# fly-hub

This repository starts with the Fly runtime and Fly dashboard source copied unchanged from `aharonyaircohen/kody-chat` commit `01696f42b05e15f85eeb6a55432baeba581878a6`.

The copied source includes `packages/fly`, the original `/fly/*` pages, their Fly and preview API routes, and their dashboard components. The initial import is a source snapshot. The pages still reference Kody Chat's shared authentication, vault, UI, and backend packages, so this repository does not yet run as a standalone dashboard. Those dependencies must be brought across or replaced before claiming the extraction is complete.

No replacement Fly dashboard has been created here.
