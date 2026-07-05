# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** Phase 3 — builder on structured data + rules engine (next)
**Last cleared:** Phase 2 — validator — 2026-07-05 (validate + typecheck both green)
**Pending deploy:** NO (feature branch `structured-mechanics-layer`, not merging until proven)
**Open for Owner:** 84 talents flagged `_needsReview`, catalogued in `data/CURATION-NOTES.md`. Confident
sphere variants (Domínio de Feras→das Feras, Guardiã→Guardião, Temporal→Tempo, Climática→Clima) and 5e
skills auto-resolved. Remaining need game knowledge (Esgrima/Berserker/Taverna sphere aliases) OR are
rules-engine design inputs (OR-alternatives, descriptive prereqs like "qualquer talento que conceda
resistência a ácido"). 2 real `pp`→`PM` source typos to fix in content.

---

## Program Overview

Refactor the data model so the character builder reads canonical structured data instead of scraping the
rendered DOM. Full plan: `C:\Users\LISHO\.claude\plans\glittery-waddling-lollipop.md`.

- **Phase 0** — schema (JSON Schema + JSDoc typedefs) + dev tooling (package.json, tsconfig, npm scripts)
- **Phase 1** — one-time migration extractor (`scripts/extract-structured.js`)
- **Phase 2** — validator (`scripts/validate.js`): schema + referential integrity + prose cross-check
- **Phase 3** — builder on structured data + rules engine (`src/rules.js`)
- **Phase 4** — modularize `app.js` into ES modules + `checkJs` green
- **Phase 5** — (deferred) render reader from structured data too

---

## Step History

### Phase 0 — Foundations — COMPLETE
*Date: 2026-07-05*

Files changed:
- `schema/talent.schema.json`, `schema/sphere.schema.json`, `schema/class.schema.json`,
  `schema/class-features.schema.json` — JSON Schemas (draft-07) for the structured layer.
- `src/types.js` — JSDoc typedefs mirroring the schemas (for `checkJs`).
- `package.json` — dev-only tooling (ajv, typescript, @types/node); scripts extract/validate/typecheck.
- `tsconfig.json` — opt-in `checkJs`, scoped to `src/` + `scripts/` (excludes legacy `split-source.js`).
- `data/README.md` — canonical data layout.

Decisions made:
- Branch `structured-mechanics-layer` created off `master`. Nothing merges until the builder is proven.
- Browser runtime stays zero-dependency, no bundler. All tooling is dev-only Node.
- Talent `cost` is structured (`base` + optional `tiers[]` + `text`) to capture tiered costs like
  "0PM (menor), 1PM (maior), 2PM (poderoso)".
- Prerequisites are typed references (`talent`/`sphere` by id, or free-text `text`) so the rules engine
  can enforce them; unresolved ones stay as `text` and get flagged `_needsReview`.

Verification: `npm run typecheck` exit 0; ajv compiles all schemas, cross-file $ref (sphere→talent)
resolves, valid sample passes, malformed id rejected.

Reviewer findings: (pending — Phase 0 self-verified; formal review at first shippable increment)
Deploy: pending

---

### Phase 1 — Migration extractor — COMPLETE
*Date: 2026-07-05*

Files changed:
- `scripts/extract-structured.js` — reuses `parser.js`+`chapters.js`+jsdom; re-implements talent/param
  detection in one auditable place; emits `data/spheres/<slug>.json`; flags `_needsReview`.

Result: **42 spheres, 1595 talents** extracted. Structured cost (tiers), params, prerequisites (typed
refs incl. new `level` type), enhancements, and body captured. **94% clean** — 100 talents flagged for
human review (ambiguous prereqs + 2 `pp` costs).

Decisions made:
- Level prerequisites are a first-class prereq type (`{type:'level', min}`); source writes "5º nível ou
  superior" (ordinal before "nível").
- Prereq parsing is paren-depth aware; sphere clauses' parentheticals list prerequisite talents scoped
  to that sphere; proficiency/package clauses kept as `text`.
- `_needsReview` flags only genuine parse uncertainty (dropped the noisy "no-params" flag — most talents
  legitimately have no ficha).

Reviewer findings: (pending)
Deploy: pending

---

### Phase 2 — Validator — COMPLETE
*Date: 2026-07-05*

Files changed:
- `scripts/validate.js` — (1) schema conformance via ajv, (2) referential integrity (talent/sphere id
  resolution + uniqueness), (3) transitional prose cross-check (parser card count == structured count
  per sphere).

Result: **`npm run validate` → 0 errors**, 38 warnings (unresolvable subclass/variant sphere prereqs —
correctly flagged). `npm run typecheck` green (scoped to `src/`).

Decisions made:
- The cross-check earned its keep immediately: it exposed a 1-line divergence between the extractor and
  the counter (non-group h4 must reset group mode) and confirmed the extractor matches the runtime
  `enhanceTalents` exactly.
- `checkJs` scope narrowed to `src/` (the type-critical browser/rules code); Node CLI tooling in
  `scripts/` is verified by running, not typed.

Reviewer findings: (pending)
Deploy: pending

---

## Known Gaps
*Logged here instead of fixed. Addressed in a future step.*

- **KG-1** — Reader still renders from `content/*.txt` (prose) during Phases 0–4. Rendering the reader
  from structured data is deferred to Phase 5.

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- The character builder consumes structured `data/` ONLY; no game rule is decided by a DOM heuristic — 2026-07-05
- Structured data is canonical for mechanics; `content/*.txt` remains the reading source until Phase 5 — 2026-07-05
- Homebrewery round-trip is retired; content may be restructured freely — 2026-07-05
- Browser stays zero-dep/no-build; Node tooling is dev-only — 2026-07-05
