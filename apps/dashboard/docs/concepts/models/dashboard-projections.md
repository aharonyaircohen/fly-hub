# Dashboard projections

Status: **Current architecture rule**

Dashboard lists, counts, labels, health, and graph views are projections over
their owning stores. They are not new models and are never persistence
authority.

Every projection must name:

- its real source;
- how unknown and stale data appear;
- which mounted command performs edits;
- how errors roll back optimistic UI.

There is no separate planning-aggregate health projection. Loop health can only
be called live after Dashboard Loop definitions are connected to the Engine
Runs that the page reads.
