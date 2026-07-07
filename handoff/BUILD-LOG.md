# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** Layout B (Bancada) restructure of `renderCharacter` BUILT, awaiting Richard's review.
**Last cleared:** Layout B — app.js/style.css — 2026-07-07 (validate + typecheck + test + sanity-builder
all green, plus a new jsdom smoke script driving the full rail/build/bench flow end-to-end incl. sphere
acquisition and talent addition through the bench; browser click-through still needs a human — see
REVIEW-REQUEST.md).
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

### Layout B (Bancada) — restructure `renderCharacter` — BUILT (pending review)
*Date: 2026-07-07*

Files changed:
- `app.js` — full restructure of the "Meu Personagem" sheet (`renderCharacter`, ~1550 lines touched)
  into the approved Layout B / Bancada from `design-previews/builder-bancada.html`: sticky left
  `.char-rail` (character tabs + `#char-new`, identity `.char-form`, proficiências in a collapsible
  `<details>`, mini-stats + new `.char-budget-bar`, `.char-railnav` sphere nav) and a right
  `.char-main` with `.char-build` (active-sphere-only panel) + `.char-bench` (master-detail
  workbench for adding talents/spheres). New module-level view state `charView = { sphere,
  benchMode, sel, scope, search }` (never persisted). New/extracted functions: `charSphereTitles`,
  `talentCandidatesForSphere`, `talentPickPath`, `talentGate` (+`prereqStatusLabel`/
  `describePrereqs`), `sphereCandidates` (pure data, extracted from the deleted
  `buildAddTalentPicker`/`buildAddSpherePicker`); `charTalentCard` (hoisted out of
  `renderCharacter`, unchanged body); `renderSphereBuildPanel` (extracted per-sphere loop body,
  keeps the `.char-sphere` class + `.char-sphere-manage` block); `buildCharBuildContent`,
  `buildRailNavHTML`, `buildCharBudgetHTML`/`statCellHTML`/`budgetBarHTML`, `buildTalentDetail`,
  `buildTalentBenchPanel`, `buildSphereDetail`, `buildSphereBenchPanel`, `buildCharBenchInner`;
  view-state helpers `resetCharView`/`normalizeCharView`/`switchActiveChar`; and the new
  `refreshCharBench()` (view-only re-render). `setupCharacter`'s delegated listeners extended
  (not replaced) with: `.char-rail-sphere` (switch active sphere), `.char-rail-addsphere` (enter
  spheres mode), `.char-bench-li` (select), `.char-bench-scope` (scope toggle), `.char-bench-acquire`
  (acquire from the bench), a new `.char-btn` branch guarded by `.closest('.char-bench')` (add
  talent from the bench detail — reuses `applyTalentToggle`), and a new `content` `input` listener
  for `.char-bench-search` (live filtering with focus/caret preservation). Removed the now-dead
  `.char-add-sphere-btn` click handler (its producer, `buildAddSpherePicker`, no longer exists).
- `style.css` — deleted the dead `.char-add-talent(-row)`/`.char-add-btn`/`.char-add-sphere(-select|
  -btn)` rules (their markup no longer exists); added the Layout B block: `.char-layout`/`.char-main`,
  rail sizing overrides for the *reused* `.char-stats`/`.char-stat` (not duplicated), `.char-profs-details`
  (collapsible proficiencies, hides `buildProficiencies`'s own inner title since the `<summary>`
  labels it), `.char-budget-bar` family, `.char-railnav`/`.char-rail-sphere`/`.char-rail-addsphere`,
  a `.char-build .char-sphere` panel-chrome override (border/bg, scoped — doesn't touch bare
  `.char-sphere`), and the full `.char-bench`/`.char-bench-grid`/`-list`/`-li`/`-detail`/`-tools`/
  `-scope`/`-search`/`-acquire` family + a collapse-to-1-column media query at 880px.

Result: `npm run validate` (0 errors), `npm run typecheck` (green), `npm test` (28/28),
`node scripts/sanity-builder.js` (29/29) all green (none of them exercise app.js's DOM wiring).
`node --check app.js` clean. Wrote a new ad hoc jsdom smoke script (same technique as
sanity-builder.js, not committed) that loads the real app.js/rules.js, calls `setupCharacter()` +
`renderCharacter()`, creates a level-5 Feiticeiro (Sangue Feérico), and dispatches real click/input
events end-to-end: empty-state render, full layout present, rail nav populated, bench list
populated, item selection (view-only patch), scope toggle, live search with focus+caret preserved
across the `.char-bench` DOM replacement, switching to spheres mode (confirms `.char-build` goes
empty), acquiring a sphere from the bench (mutation → budget/rail updates), adding a talent from
the bench detail's Add button (mutation, owned-count grows), and confirmed
`renderSphereAcquireBar` (reading-page bar) is untouched and still returns `.sphere-acquire`.
24/24 assertions passed. Full manual browser click-through still needed — see REVIEW-REQUEST.md.

Decisions made:
- `refreshCharBench()` patches BOTH `.char-build` and `.char-bench` (not just `.char-bench` as the
  literal brief text says) — necessary because switching the active sphere via the rail is a
  view-only action that changes which sphere's panel `.char-build` must show; without this, the rail
  highlight would move but the build panel would show the stale sphere. The rail's own
  form/proficiências/stats are left untouched (mutation-only, unaffected by view actions). Flagging
  this explicitly for Arch/Richard since it's a deliberate broadening of the brief's literal scope,
  not a miss.
- `buildAddTalentPicker`/`buildAddSpherePicker` were deleted rather than kept-but-unused: their DOM
  output (inline pill row / `<select>`+button) has no place in Layout B (the bench replaces both),
  so keeping them would be dead code. Their filtering logic was extracted verbatim into
  `talentCandidatesForSphere`/`sphereCandidates` (same predicates, same order) so nothing was
  reimplemented, just re-shaped from "build DOM" to "return data".
- Gate-only display logic (`talentGate`) mirrors `applyTalentToggle`'s exact branching (free-path
  via `Rules.prereqCheck` when there's cap room and the sphere isn't granted-only, else extra-path
  via `Rules.canAddTalent`) so the bench's blocked/available labels can never diverge from what
  clicking Add will actually do — no new rule surface.
- The bench's Add button reuses `makeCharControl` as-is (brief's explicit instruction) rather than
  a custom disabled-state button like the mockup's "Indisponível" — prereq-blocked clicks still go
  through `applyTalentToggle` → `showCharNotice`, identical to every other `.char-btn` in the app;
  the block is communicated via the detail's gate line (⚠ + reason), not by disabling Add.
- Per-sphere `_unresolvedLegacy` warnings (migration leftovers) are now only visible when that
  sphere is the active one in `.char-build`, instead of all-at-once as before — an expected
  consequence of master-detail (you only see one sphere's detail at a time), not a P1/P2/reading-bar
  regression.

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

- **KG-5 (Metamágica — restricted allowance)** — Feiticeiro's **Metamágica** feature
  (`class-features.json`) already carries `"group": "talento (Meta) da esfera Universal"`, but
  `Rules.classFeatureBonus` (src/rules.js:104) ignores `group` and just adds `bonusByLevel` (+2/+3/+4
  cumulative) to the **general** magic budget — so the extra picks can be spent on ANY sphere. Correct
  rule: those N picks are a **restricted allowance**, usable only on Universal **Meta** (metaesfera)
  talents, at cost 0, without inflating the general budget. Needs a new grant/allowance type in the
  rules engine + surfacing it in the builder (like P1/P2 in scope). **Owner decision: implement as a
  dedicated increment AFTER the Layout B UI is validated & committed** (keeps the UI branch commit
  UI-only). Note text already fixed (2026-07-07); the enforcement is what's deferred.

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- The character builder consumes structured `data/` ONLY; no game rule is decided by a DOM heuristic — 2026-07-05
- Structured data is canonical for mechanics; `content/*.txt` remains the reading source until Phase 5 — 2026-07-05
- Homebrewery round-trip is retired; content may be restructured freely — 2026-07-05
- Browser stays zero-dep/no-build; Node tooling is dev-only — 2026-07-05
