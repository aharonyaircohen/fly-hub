# Loop implementation

Status: **Repository and Todo-derived Loops execute through the Engine scheduler**

## Dashboard

- Page: `/agent-loops`
- API: `/api/kody/loops`
- Validator: `packages/agency-domain/src/index.ts`
- Storage:
  `.kody-engine/definitions/loops/<id>/loop.json` in the selected GitHub
  repository

The Dashboard can list, create, update, and delete the simple Loop definition.
Listing is read-only. Definition writes synchronize that Loop's Convex wake
registration; Todo saves synchronize their own monitoring registration in the
same transaction. Unchanged schedules retain their current deadline, including
an overdue deadline.

A definition write can succeed while wake synchronization fails. The API reports
that partial outcome with `loop_schedule_sync_failed` and allows retrying the same
change. An identical create retry synchronizes the schedule without committing
the definition again. Recover existing missing registrations explicitly after
deployment; opening the page does not repair schedules.

The Engine's bulk registration API remains compatible with its published client.
It preserves registrations owned by existing Todos and derives their schedule
from the Todo, even when a repository snapshot omits them.

## Engine

Convex checks for due Engine work every 5 minutes through the authenticated
runner pool. The scheduler combines repository Loop definitions with temporary
Loops derived from active Agency-request Todos in Convex. GitHub Actions keeps
manual `workflow_dispatch`, but no longer owns the recurring clock.

- manual and schedule dispatch work;
- idempotency, capacity, leases, and Run recording prevent duplicate work;
- a failed Agency-request Workflow leaves its temporary Loop active;
- end-to-end Workflow success removes the Loop reference from the Todo, so the
  next scheduler wake no longer sees it;
- event-driven behavior remains owned by Triggers.

## Required integration

Repository-authored Loop definitions remain repository content. Temporary
Agency-request Loops are runtime state derived only from the owning Todo; they
are never committed to the repository or stored as a second state record.

## Live verification

The feature is complete only when a Loop created in `/agent-loops` fires in the
real Engine, invokes its real Workflow/Capability and LLM, writes a Run, avoids
duplicate firing, and appears in the Dashboard after reload.
