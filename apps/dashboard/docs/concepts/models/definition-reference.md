# Definition references

Status: **Future shared contract**

The simplified domain package uses `{ kind, id }` references for Loop targets,
Workflow Capability steps, and Run targets. Mounted Workflow code currently
uses string slugs instead. Immutable pinned revisions are not one shared
current contract.

A future shared reference may add a revision, but only after Agent, Capability,
Workflow, Loop, and Run use the same published package. Do not add revision
fields to one surface while other loaders ignore them.
