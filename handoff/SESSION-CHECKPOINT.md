# Session Checkpoint — 2026-07-05
*Read this before reading anything else. If it covers current state, skip BUILD-LOG.*

---

## Where We Stopped

Structured-mechanics-layer refactor, branch `structured-mechanics-layer`, 10 commits (master untouched).
**Phases 0–2 + curation + Phase 3 steps 1–4 COMPLETE and committed.** The character builder now reads all
rules from structured data (`data/` via `src/rules.js`+`src/data.js`), blocks illegal picks, and stores
character state as ids with non-destructive migration. Built by Bob, reviewed SHIP by Richard, Architect-
verified. Curation done: 1596 talents, only 18 Bucket-3 flags (rules-engine prereq types) remain.
All checks green: validate 0 err · typecheck · test 12/12 · sanity-builder 23/23.

**NEXT ACTION — the gate before merge:** manual BROWSER smoke test (see `handoff/REVIEW-REQUEST.md`
7-item list), ESPECIALLY loading the app against real pre-existing localStorage saved characters to
confirm migration on real state. Only Arch/Owner (with a browser) can do this — automated checks can't.
After that passes: consider Phase 4 (modularize app.js into ES modules + expand checkJs) and Phase 5
(render reader from structured data), plus the Bucket-3 rules-engine prereq types (OR/tag/package).

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
