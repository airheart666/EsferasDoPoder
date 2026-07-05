# Session Checkpoint — 2026-07-05
*Read this before reading anything else. If it covers current state, skip BUILD-LOG.*

---

## Where We Stopped

Structured-mechanics-layer refactor, branch `structured-mechanics-layer`, 5 commits (master untouched).
**Phases 0–2 + curation + Phase 3 step 1 complete**: schema/tooling, extractor (1595 talents, 42 spheres),
validator (0 errors), curation notes, and the **pure rules engine `src/rules.js`** (typed + `npm test`
12/12 — blocks illegal picks, budgets talent slots, resolves granted spheres). Live `app.js` NOT yet
touched. Next: **Phase 3 steps 2–4** — migrate classes/class-features into `data/` with talent ids,
`src/data.js` browser loader, wire app.js to rules.js + id-based character state + block in UI, then
Richard's review + deploy gate.

---

## What Was Decided This Session

- Keep the vanilla-JS/no-build stack; refactor the DATA MODEL (no rewrite). Full plan:
  `C:\Users\LISHO\.claude\plans\glittery-waddling-lollipop.md`.
- Full rules engine target; Homebrewery retired; incremental sphere-by-sphere; offline Node tooling OK
  (browser stays zero-dep).
- Structured data (`data/`) is canonical for mechanics; builder consumes it exclusively; validation keeps
  it honest. Reader keeps prose pipeline until Phase 5.

---

## Still Open

- **100 talents flagged `_needsReview`** (ambiguous prereqs: OR-alternatives, subclass/variant sphere
  names like Berserker/Esgrima/Guardiã/Domínio de Feras; 2 real `pp`-cost typos in source). Needs
  game-knowledge to curate — decide whether Owner or Arch resolves them.
- Whether to commit Phases 0–2 to the branch now (Owner had said "decide if it's worth it" before git).
- Phase 3 design: character state moves to talent `id` references (from `{name,anchor,slug}`); migrate
  `classes.json`/`class-features.json` into `data/` and add `id`s to grants.

---

## Resume Prompt

Copy and paste this to resume:

---

You are the Architect on this project. Read CLAUDE.md, then ARCHITECT.md, then SESSION-CHECKPOINT.md.
Phases 0–2 of the structured-mechanics-layer are done and validating green. Confirm state, then continue
with Phase 3 (builder on structured data + rules engine). Then wait.

---

## Version Check
version_notified: v1.3.0
