# Known Gaps

## Missing design-reference files (recorded 2026-08-30)

The brief named three files to read. Only one was present.

| Named | Actual | Status |
|---|---|---|
| `Note_Detail_dc.html` | `Note Detail.dc.html` | Present, filename differs |
| `App_Surfaces_dc.html` | — | Missing |
| `support.js` | — | Missing |

Impact: none on this build. `Note Detail.dc.html` turn 3 contains the full
layout, the locked token spec (3c), the mock data, and the citation-click
behavior. `App_Surfaces_dc.html` was reference-only for shared-component
patterns; `support.js` was explicitly not to be shipped. Nothing was guessed at.

Open: shared badge/button/nav conventions from App Surfaces are unverified.
Revisit before building a second surface.

## State management — Zustand not used here (recorded 2026-08-30)

Zustand not invoked here — state is local to one component, no drawers/cross-route
state in this build. Revisit if a second stateful surface needs to share state.

This is a divergence from the locked DECISIONS.md choice of Zustand for ephemeral
client UI state. `note-detail-shell.tsx` uses plain `useState` for the three pieces
of state (active segment, selected persona, composer draft). Recorded, not silent.

Note: no `DECISIONS.md` file was found on disk under `C:/Projects` at the time of
writing, so this divergence is recorded from the stated decision rather than from
a checked-in file.
