# Chat progress (per-user position)

Kody gives the chat model two generic, business-agnostic tools for
remembering where a user is in any sequence — a lesson, an onboarding
flow, a multi-step form, a quiz. Kody stores only a number per user per
key; it never knows what the key or number mean. The meaning lives
entirely in your agent's prompt.

## The tools

- `get_position(key)` → returns the saved number for `key` (0 if none).
- `set_position(key, position)` → saves `position` for `key`.

`key` is any string the model chooses — by convention the id/slug of the
thing being tracked (e.g. a lesson id), so the model can match the number
back to the right content. Two flows in parallel just use two keys.

Storage: the value goes into the user's `progress` state
(user-state), which routes to your configured backend (e.g. MongoDB via
the CMS adapter). No setup, no admin page — the tools are always
available to the chat.

## Wiring it into a brand (agent prompt)

Kody doesn't decide to use the tools — your agent's system prompt does.
Add an instruction like this to the brand's agent:

```
You teach lessons step by step. A lesson's steps live in the `lessons`
content collection; read the lesson the user asks for with the CMS tools.

Track progress so the user resumes across sessions:
- At the start, call get_position("lesson:<lessonId>") to find their step.
- Teach ONLY that step. Do not jump ahead.
- When the user has clearly completed the step, call
  set_position("lesson:<lessonId>", <nextStepNumber>).
```

That is the entire integration: the model reads your content from your
own data, teaches from it, and uses get/set position to remember the
place. Nothing about lessons exists in kody — swap "lesson" for
"onboarding", "intake", or "quiz" and the same two tools apply.
