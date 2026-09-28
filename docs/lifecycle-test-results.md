# Fly Hub lifecycle verification — 2026-09-28

The opt-in live test in `packages/fly/tests/live/managed-machine-lifecycle.spec.ts` used two disposable Fly apps in the `personal` organization. It left the user's existing test machine untouched and removed both disposable apps afterward.

| Check | Result |
| --- | --- |
| Create with idle sleep on and off | Passed; Fly stored `autostop: "suspend"` and `autostop: false` respectively. |
| Manual suspend | Passed; machine reached `suspended`. |
| Start after suspend | Passed; machine reached `started`. |
| Manual stop | Passed; machine reached `stopped`. |
| Start after stop | Passed; machine reached `started`. |
| Idle sleep on | Passed; Fly Proxy suspended the unused machine after several minutes. |
| Idle sleep off | Passed; the comparison machine remained `started` through the same observation period. |
| SSH wake-up | Passed; a TLS-wrapped SSH connection woke the suspended machine and returned an OpenSSH banner. |
| Terminate | Passed; the machine disappeared from Fly's machine list. |
| Cleanup | Passed; both disposable apps were deleted and are absent from `flyctl apps list`. |

The first live run used a short-lived `flyctl auth token` and lost API access during the idle wait. It could not finish cleanup. The resumed run used the repository's longer-lived `FLY_API_TOKEN`, completed every check, and removed those same test apps. The live test now requires that token for long observation runs.

The dashboard browser tests cover its Suspend, Resume, and Destroy buttons, plus both states of the Sleep when idle checkbox. Stop is a Fly Machines API operation; the dashboard does not currently show a separate Stop button.
