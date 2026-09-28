# Quality authoring

Quality describes a real user test without storing browser scripts.

Its purpose is simple: a Scenario passes only when the live result matches the
saved outcomes and the run captures proof from that same run.

## Model

- **Action:** one simple semantic user step and its expected result. Examples:
  `Enter the token`, `Send the message`, or `Reload the chat`. Do not combine
  goals with “and”, and do not write selectors or implementation commands.
- **Journey:** ordered Actions that complete one user goal. Examples: `Sign in`
  or `Use Kody`. A Journey must not repeat setup already owned by an earlier
  Journey in the same Scenario.
- **Scenario:** ordered Journeys that complete one full test, together with its
  starting conditions and required proof.
- **Quality Run:** the evidence and result produced automatically when the
  Scenario runs. Checking that the Quality Run exists is not a test Action.

## How success is decided

- An Action passes only when its saved outcome is visible after that Action.
- A Journey passes only when every ordered Action passes and its user goal is
  complete.
- A Scenario passes only when every Journey passes and both its final visible
  result and saved-state result are proven.
- Missing proof is never a pass. Use `blocked` when the environment prevents a
  fair test, and `failed` when the product contradicts the expected result.

The executor chooses how to use the current page, but it does not choose what
success means. The saved Action outcomes and Scenario expectations define
success.

## Where the test runs

The repository's existing GitHub Engine runs a Quality test. A Scenario's
website is only the public URL that the test opens. Selecting a Vercel, Fly, or
other website does not move the runner there.

## Authoring order

1. Write the Scenario's full user outcome.
2. Split it into distinct user goals; these are the Journeys.
3. Split each Journey into the smallest meaningful user steps; these are the
   Actions.
4. Remove repeated setup and bundled steps.

## Write checkable outcomes

Describe something the run can see or confirm. Avoid broad results such as
`Chat works`, `The page is correct`, or `The operation succeeded`.

Good Action outcome:

> A committed assistant reply containing the requested marker appears.

Good final visible result:

> The same user message and assistant marker reply are visible after reload.

Good final saved-state result:

> The conversation stores the selected model and both committed messages.

For changes that should persist, include a reload or reopen Action. For
repository changes, require the exact expected path or content and clean up only
data created by the run.

Keep Actions semantic so Kody can choose the correct controls from the live
page. Write `Submit sign-in`, not `Click #login-button`.

Before activating a Scenario, run one known-good pilot and one intentional
failure. The good pilot must pass with current-run proof, and the intentional
failure must not pass.
