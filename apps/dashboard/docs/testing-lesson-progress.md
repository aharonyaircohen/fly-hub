# Test guide: lesson progress + resume from checkpoint

This walks through the whole feature by hand: attach a progress
capability to an agent, advance through a lesson in chat, then confirm a
new session resumes from the saved step. ~10 minutes.

## What you're testing

Kody stores one number per student (their step). A capability's prompt
tells the chat model to save it with `set_position` and read it back with
`get_position`. Nothing about "lessons" lives in kody — the brand's
capability supplies the meaning.

---

## Step 1 — Create the progress capability

1. Open the dashboard → **Capabilities**.
2. Create a capability named **track-progress**.
3. In its **tools**, allow `get_position` and `set_position`.
4. In its **instructions** (prompt), paste:

   > You teach a lesson step by step. At the start of the conversation,
   > call get_position with key "lesson" to find the student's step and
   > resume there. When the student finishes a step, call set_position with
   > key "lesson" and the next step number so their progress is saved.

5. Save. (If you author the file by hand instead, its `profile.json`
   **must** include `inputs: []` and `scripts: { preflight: [], postflight: [] }`
   or the capability is silently skipped.)

## Step 2 — Attach it to your agent

1. Open the dashboard → **Agents** → your teaching agent.
2. Under **Capabilities**, tick **track-progress**.
3. Save. (Behind the scenes this writes `capabilities: [track-progress]`
   into the agent's markdown — you never type tool names.)

## Step 3 — Advance through the lesson

1. Open a chat with that agent (the brand chat, or pass the agent on the
   dashboard chat).
2. Say: **"I finished step 3 of the lesson."**
3. The model calls `set_position("lesson", 4)` on its own and confirms.

**Verify it saved:** in your backend (or Mongo, if that's your
backend) open the student's progress record —
`user-state/progress/<user>.json` — and check `position:lesson` is `4`.

## Step 4 — Resume from the checkpoint

1. Start a **new** chat with the same agent (or just reload).
2. Say: **"Where am I in the lesson?"** or **"Let's continue."**
3. The model calls `get_position("lesson")`, reads `4`, and picks up at
   step 4 — no need to tell it where you were.

## Pass criteria

- After step 3, `position:lesson` in the student's progress record equals
  the new step number.
- After step 4, the model resumes at that number in a fresh session.

## Notes

- Use a capable model. Weak models sometimes reply in text instead of
  calling the tool; if the number doesn't change, that's the model, not
  the wiring — retry or switch models.
- "lesson" is just a key the model picks; two lessons in parallel use two
  keys (`get_position("fractions")`, `get_position("decimals")`) and keep
  separate numbers.
