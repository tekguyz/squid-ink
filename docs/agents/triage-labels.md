# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ----------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Size labels (added 2026-09-23)

Every issue also carries one size label. It says which path the work takes.

| Label          | Path                                                                 |
| -------------- | -------------------------------------------------------------------- |
| `size:small`   | The issue is the ticket. `/implement #N` directly. No grill, no spec. |
| `size:feature` | `/grill-with-docs` → `/to-spec` → `/implement`. Skip `/to-tickets`.   |
| `size:big`     | `/grill-with-docs` → `/to-spec` → `/to-tickets` → `/implement` each.  |

"Big" means several separable features, or more than one migration. Find quick
wins with `gh issue list --label size:small`.
