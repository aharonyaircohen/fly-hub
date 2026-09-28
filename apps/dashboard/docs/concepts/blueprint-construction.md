# Blueprint construction

Status: **Current Dashboard and Store contract**

A Blueprint turns a reusable Store recipe into repository-specific Agency
behavior. The user authorizes this once by applying the Blueprint. Kody then
owns the work until it succeeds end to end or needs a real user decision.

## The two Loop types

| Loop        | Lifetime  | State owner        | Responsibility                                         | End condition                                                   |
| ----------- | --------- | ------------------ | ------------------------------------------------------ | --------------------------------------------------------------- |
| Constructor | Temporary | One Todo           | Prepare, run, monitor, repair, and retry the Blueprint | Verified success and completion Report, or a real user decision |
| Maintainer  | Durable   | Installed Solution | Monitor or repair the completed Solution               | User disables or removes the Solution                           |

Workflow conditions and bounded step retries are internal orchestration. They
do not create another product-level Loop type.

## Ownership

- **AgencyRequestManager** creates or reuses one repository-and-Blueprint Todo.
- **Todo** stores the requirement, plan, current phase, evidence, blockers,
  Workflow runs, Constructor reference, and final Report reference.
- **Constructor Loop** is derived from an active Todo. It is not a second saved
  planning object and does not duplicate Todo state.
- **Blueprint Workflow** performs one repository-specific implementation
  attempt. Its own repair steps may fix CI and repeat bounded checks.
- **Store installation bundle** carries configuration and exact Store-owned
  repository files into the same implementation pull request.
- **Maintainer Loop** is part of the installed Solution and becomes durable
  only through the successful implementation pull request.

## Lifecycle

1. The user applies a Blueprint from the Store.
2. Kody installs the repository launcher when it is missing.
3. AgencyRequestManager creates or resets one short Todo such as
   `Build Web Release`.
4. Store activation prepares one installation bundle. It does not write the
   Blueprint's Agency files directly to the default branch.
5. The Constructor dispatches the Blueprint Workflow with the request,
   installation bundle, and verified success criteria.
6. A failed or blocked Workflow attempt leaves the Todo and Constructor active.
   The next Constructor wake resumes from the saved Todo and dispatches the
   prepared Workflow again. Workflow repair stages diagnose and fix
   repository-level failures.
7. A real decision that cannot be derived from repository evidence moves the
   Todo to waiting-for-information and creates one clear Inbox question.
8. Successful end-to-end verification completes every Todo item, publishes a
   detailed Report, removes the Constructor reference, and leaves the Maintainer
   definition in the verified implementation pull request. After that pull
   request is accepted, the Maintainer becomes the ongoing owner.

## Installation bundle

The bundle is generic and may contain:

- `configPatch`: the Store activation fields to merge into `kody.config.json`;
- `files`: exact Store-owned repository files, each with a repository-relative
  path and complete text content.

The Blueprint Workflow delivers both in its pull request. File paths remain
restricted by the capability's delivery allowlist. Credentials and runtime
state are never installation files.

## Failure rules

- A repository implementation, validation, or CI failure is Constructor work;
  keep the Constructor active and retry through the Workflow.
- A transient dispatch failure keeps the same Todo and evidence; do not create
  another Todo.
- An invalid Store package or platform contract is a product defect. Record the
  precise blocker, fix the owning package, and resume the same request.
- Missing information pauses only when Kody cannot safely infer a real owner
  decision.
- `blocked` is evidence, not permission to abandon a fixable request.

## Completion proof

Construction is complete only when all applicable evidence exists:

1. One Todo owns the full request history.
2. The repository-specific pull request contains the implementation and Store
   installation bundle.
3. Required checks pass after any repair attempts.
4. The Blueprint's verification criteria pass against the real repository and
   live service when required.
5. The completion Report links the Todo, Workflow Run, pull request, checks,
   and live evidence.
6. The Constructor is gone and the Maintainer is present in the verified pull
   request, ready to become active when that pull request is accepted.
