# Storage authority

Status: **Current verified map**

| Data                                    | Authority                                           |
| --------------------------------------- | --------------------------------------------------- |
| Intent, Context, Policy, Constraint     | Convex `repoDocs`                                   |
| Todo lists                              | Convex `repoDocs`                                   |
| Local Capabilities                      | Convex `repoDocs` folder maps                       |
| Local Agents                            | Versioned Convex definition bundles                 |
| Local Workflows                         | Convex workflow store                               |
| Dashboard simple Loops                  | GitHub `.kody-engine/definitions/loops`             |
| Runs, events, approvals, dispatch state | Convex                                              |
| Store assets                            | GitHub-backed Kody Store, read-only to the consumer |
| UI projections                          | Derived                                             |

GitHub is allowed for repository content and Engine definitions. It is not
allowed as a fallback, bootstrap, or dual-write target for runtime state.

The Engine scheduler currently reads older Convex Agency Loop definitions, not
the Dashboard simple Loop files. That is an unresolved authority split.
