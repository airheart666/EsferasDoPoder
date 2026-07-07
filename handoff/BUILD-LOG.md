# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** P3 (full in-sheet character builder) BUILT, awaiting Richard's review.
**Last cleared:** P3 — app.js/style.css — 2026-07-06 (validate + typecheck + test + sanity-builder all
green, plus ad hoc jsdom event-driven smoke checks of the new sheet controls; browser click-through
still needs a human — see REVIEW-REQUEST.md).
**Pending deploy:** NO (feature branch `structured-mechanics-layer`, not merging until proven)
**Curation DONE (Buckets 1 & 2):** flags 100→18. All talent-name mismatches resolved (sphere
self-references fixed at source; talent-name variants via extractor `TALENT_ALIAS`; source renames
Ataque→Golpe, Pomada→Bálsamo, Tempo→sphere-req; Borda Irregular card-split; 2 pp→PM typos). The
remaining 18 are Bucket 3 = rules-engine prereq TYPES (OR-groups, tag/package/descriptive), logged as
Phase 3 backlog in `data/CURATION-NOTES.md` — not data bugs.

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

### Phase 3 (step 1) — Rules engine — COMPLETE
*Date: 2026-07-05*

Files changed:
- `src/rules.js` — pure, typed rules engine (dual-mode like parser.js): index; derived stats; talent-slot
  budget (progression + tradition + feature bonus); granted spheres; owned/accessed sets; prereq check
  (talent/sphere/level enforced, text→unverified); canAddTalent/canAccessSphere.
- `src/types.js` — Character/CharSphere/DataIndex/PrereqResult typedefs.
- `scripts/test-rules.js` + `npm test` — 12 assertions on real data.

Result: `npm test` 12/12; `npm run typecheck` green. Confirms the target behavior: advanced talent is
BLOCKED without its sphere/prereq-talents/level and passes once met; over-budget blocked; granted access
free. Live app.js NOT yet touched (safe).

Decisions made:
- Build budget = talent slots (magic/martial), not PM (PM is a derived casting pool). Matches app.js:1654.
- Structured prereqs block; `text` prereqs are "unverified" (surfaced, never silently pass/block).

Reviewer findings: (formal Richard pass deferred to end of Phase 3, when app.js is wired)
Deploy: pending

---

### Phase 3 (step 4) — Wire app.js to the rules engine — BUILT (pending review)
*Date: 2026-07-06*

Files changed:
- `index.html` — added `src/rules.js` + `src/data.js` `<script>` tags before `app.js`.
- `app.js` — data layer swapped from root `classes.json`/`sphere-rules.json`/`class-features.json`
  fetches to `DataLoader.loadData()` + `Rules.indexData()` (module global `dataIndex` +
  `sphereIdByTitle`/`sphereTitleById`); `getSphereModel`/`classSpec` reimplemented to classify
  base/free/extra from `sph.acquisition` + `talent.tags/kind/group` (structured), not the DOM
  (`cardRole`/`matchesFreeGroup`/`sphereTags` retired); `characterStats`/`traditionBonus`/
  `classFeatureBonus` now delegate to `Rules.derivedStats`/`traditionBonus`/`classFeatureBonus`;
  `renderCharacter`'s used/budget numbers now come from `Rules.slotsSpent`/`talentBudget`.
  Persisted character shape changed: `char.spheres[].sphere` is now the sphere id (was title);
  `.freePicks`/`.talents` are now talent-id arrays (were `{name,sphere,anchor,slug}` objects) —
  matches `src/types.js` `CharSphere` exactly. New enforcement wrappers `addFreePickChecked`/
  `addExtraTalentChecked`/`tryAcquireSphere` call `Rules.prereqCheck`/`canAddTalent`/
  `canAccessSphere` before mutating state; blocked picks show a transient `.char-warn` notice
  (`showCharNotice`). `migrateCharacters()` extended to convert existing saved characters
  non-destructively (title→id, item→talent-id; unresolvable items moved to
  `entry._unresolvedLegacy`, never dropped).
- `style.css` — one rule (`.char-warn-toast`) for the new transient notice.
- `scripts/sanity-builder.js` (new, not wired into `npm test`) — loads the real app.js/rules.js
  into jsdom and drives prereq/budget/migration scenarios against real data.

Result: `npm run validate` (0 errors), `npm run typecheck` (green), `npm test` (12/12) all still
green — none of them touch app.js. `node scripts/sanity-builder.js` — 23/23 assertions (prereq
block/allow, talent-budget block, sphere-access-budget block, granted-sphere free access, and
non-destructive migration incl. an intentionally-unresolvable legacy talent).

Decisions made:
- `getSphereModel`/`classSpec` read `sph.acquisition` (structured) instead of root
  `sphere-rules.json` — confirmed byte-identical for all 42 spheres before switching.
- Card *display* still clones rendered HTML via `buildChapterCardFrag`/`findCardInFrag`
  (homonym talents disambiguated via `.base-ability` ⟺ `kind:'base'`, not DOM section anchors).
- `rules.js` is treated as frozen (per brief) — its documented gap (granted specific talents from
  class-features aren't in `ownedTalentIds`) is unchanged behavior from before this step, not a
  regression; app.js keeps its own title-keyed `grantedSpheresMap` for the "included with the
  sphere" display, now sourced from `dataIndex.classFeatures` instead of the DOM/root global.

Reviewer findings: pending — see `handoff/REVIEW-REQUEST.md`.
Deploy: pending

---

### P3 — Full in-sheet character builder — BUILT (pending review)
*Date: 2026-07-06*

Files changed:
- `app.js` — extracted `buildPackageSelector`/`buildFreePickSelectors`/`applyFreePickSelection`
  out of `renderSphereAcquireBar`'s inline blocks (behavior-preserving refactor, verified by
  driving the reading-page bar's events post-refactor); `renderSphereAcquireBar` now calls
  them. Added `buildAddTalentPicker` (reuses `makeCharControl`) and `buildAddSpherePicker` (new).
  `renderCharacter`'s per-sphere loop now renders a package selector + free-pick selectors +
  add-talent picker per sphere, and an add-sphere picker near the top of the section.
  `setupCharacter`'s click/change handlers extended to own all of this inside `.char-sphere`
  (full `renderCharacter()` re-render on mutation); `setupFavorites`'s `.pkg-select`/
  `.freepick-select`/`.char-btn` handlers each got a one-line `.closest('.char-sphere')` guard
  so the two delegated listeners (both bound to the same `#content`) don't double-handle the
  same control.
- `style.css` — new rules for `.char-sphere-manage`, `.char-add-talent(-row)`, `.char-add-btn`,
  `.char-add-sphere(-select|-btn)`. The inner controls reuse existing global styles unchanged.

Result: `npm run validate` (0 errors), `npm run typecheck` (green), `npm test` (28/28),
`node scripts/sanity-builder.js` (29/29) all green (none of them exercise app.js's DOM wiring).
Additionally ran ad hoc Node+jsdom scripts during the build (same technique as
sanity-builder.js, not committed) that load the real app.js and drive actual dispatched
click/change events against the new sheet controls end-to-end: package selection, free-pick
selection (incl. a granted sphere per P1), add-talent (extra-talent path), add-sphere (incl.
a budget-exhausted blocked case producing a `.char-warn-toast`), and confirmed the reading-page
bar (rendered standalone, outside `.char-sphere`) still mutates via `setupFavorites` as before.
Full manual browser click-through still needed — see REVIEW-REQUEST.md checklist.

Decisions made:
- Disambiguate the shared-classname double-listener risk via DOM ancestry
  (`.closest('.char-sphere')`) rather than new data-attributes — zero markup overhead, and the
  two container classes (`.char-sphere` / `.sphere-acquire`) are already mutually exclusive by
  construction (sheet vs. reading page).
- Sheet re-render strategy is always a full `renderCharacter()` (not the reading page's
  `refreshSphereUI` DOM patch) — matches how every other sheet mutation already worked
  (`.char-talent-remove`, `.char-sphere-remove`, `.char-field`).
- No `src/rules.js` changes; no new persisted-state shape; every mutation goes through the
  pre-existing enforced wrappers.

Reviewer findings: pending — see `handoff/REVIEW-REQUEST.md`.
Deploy: pending

---

## Known Gaps
*Logged here instead of fixed. Addressed in a future step.*

- **KG-1** — Reader still renders from `content/*.txt` (prose) during Phases 0–4. Rendering the reader
  from structured data is deferred to Phase 5.
- **KG-2** — `Rules.ownedTalentIds` doesn't fold in class-features-granted *specific* talents (only
  granted sphere access + base talents + chosen picks) — `rules.js` itself documents this as a future
  step. Not a regression: those granted talents never cost a slot or counted as "owned" for prereqs
  before this step either. Would need a `rules.js` change (out of scope — "use it, don't rebuild").
- **KG-3** — Legacy saved characters with a homonym talent (e.g. Conjuração's base vs. advanced
  "Invocação") that hasn't been migrated to ids yet cannot be auto-resolved during migration (no DOM
  signal available to disambiguate) — kept in `entry._unresolvedLegacy`, surfaced in the character
  sheet, never silently dropped. Affects at most 1-2 spheres, only pre-this-change saves.
- **KG-4 (P2 follow-up)** — Universal's **Criação de Magias** package has stricter, unmodeled rules:
  (a) access requires the character to already have ≥ 2 other magic spheres; (b) its free (esfera dupla)
  pick must satisfy that talent's OWN multi-sphere prerequisites — the two spheres it names + any specific
  talent — which are encoded only in the talent's name/tags (e.g. "Transformar Objeto (esfera dupla,
  Alteração, Aprimoramento (Animar Objeto))" ⇒ needs Alteração + Aprimoramento spheres + the Animar Objeto
  talent), not in the structured `prerequisites`. Deferred per Owner. Needs: a package-access prereq
  (N spheres of a section) + parsing (esfera dupla) talents' dependencies into structured prereqs.
  Related minor open item: whether Universal's general/untagged talents (Contrafeitiço, Foco Místico,
  Pacote Universal, the "Extremo" advanced ones) should be pickable regardless of the chosen package
  (currently `talentTags` scopes them out).

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- The character builder consumes structured `data/` ONLY; no game rule is decided by a DOM heuristic — 2026-07-05
- Structured data is canonical for mechanics; `content/*.txt` remains the reading source until Phase 5 — 2026-07-05
- Homebrewery round-trip is retired; content may be restructured freely — 2026-07-05
- Browser stays zero-dep/no-build; Node tooling is dev-only — 2026-07-05
