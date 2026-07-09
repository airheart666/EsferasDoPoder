# Build Log
*Owned by Architect. Updated by Builder after each step.*

---

## Current Status

**Active step:** Cloud Phase 2 — mesa/campanha UI (app.js/style.css) BUILT, awaiting Richard's review.
**Last cleared:** Cloud Phase 2 UI — app.js/style.css — 2026-07-09 (typecheck + test + sanity-builder +
node --check all green, plus a new jsdom smoke script driving expose/unexpose + the real click→prompt→
Cloud call flow + the GM #mesa view end-to-end off injected events; browser click-through with 2 Google
accounts still needs a human — see REVIEW-REQUEST.md).
**Pending deploy:** NO (branch `cloud-tables`, not merging until proven)
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

### KG-5 — Metamágica: UI da cota restrita — BUILT (pending review)
*Date: 2026-07-07*

Files changed:
- `app.js` — `METAMAGIC_KEY` module-level sentinel constant (value `'mm:Metamágica'`) for
  `charView.sphere`. `metamagicAllowance(active)` helper (wraps `Rules.restrictedAllowances`,
  the rules layer consumed as-is — 0 changes to `src/rules.js`/data/schema). Accordion
  (`buildCharBuildContent`) appends the Metamágica entry after the sphere titles when an
  allowance exists: `buildCollapsedMetamagic` (reuses `.char-sphere-collapsed` + the existing
  `.char-sphere-collapsed`/`.char-sphere-toggle` handlers via the sentinel — no new expand/
  collapse handler) and `renderMetamagicPanel` (mirrors `renderSphereBuildPanel`: `.char-sphere`
  container, cards via `charTalentCard(frag, id, 'free', 'Universal')`, a dedicated
  `.char-mm-remove` ✕ — NOT `.char-talent-remove`, which calls `toggleExtraTalent` against
  `spheres[].talents` and would corrupt state). Bench mode: `buildTalentBenchPanel` branches to
  `buildMetamagicBenchPanel` when `charView.sphere === METAMAGIC_KEY` (never falls into the
  normal esfera/scope path); `metamagicCandidates` filters the allowance's sphere (`Universal`)
  by `allowance.tag` (`metaesfera`) minus `Rules.ownedTalentIds` (already folds in
  `char.metamagic` AND every normal pick — dedupe both directions is free); `buildMetamagicDetail`
  mirrors `buildTalentDetail`'s layout but the action button is `.char-mm-add` (not
  `makeCharControl`/`applyTalentToggle` — cost 0, outside the general budget), disabled
  ("Cota cheia") once `char.metamagic.length >= allowance.count`. `talentCandidatesForSphere`
  now also excludes `char.metamagic` ids (so a Metamágica pick can't reappear as a purchasable
  extra in Universal's own talent list). `setupCharacter`'s existing delegated click listener
  extended (not replaced) with `.char-mm-add` (push + `updateCharacter` + full `renderCharacter()`,
  guarded by cap+tag, `showCharNotice` on cap-full) and `.char-mm-remove` (filter out + same).
  `normalizeCharView` now treats `METAMAGIC_KEY` as valid only while `metamagicAllowance(active)`
  is non-null (feature lost, e.g. level drop below 3 → resets like any removed esfera).
  `migrateCharacters` guarantees `char.metamagic = []` when absent/non-array.
- `style.css` — reused `.char-sphere`/`.char-sphere-collapsed`/`.char-cards`/`.char-bench-*`
  wholesale; new rules: `.char-mm-remove` (shares the `.char-talent-remove` declaration, incl.
  inside `.char-talent-extra >`), `.char-mm-add` (shares the `.char-btn.char-bench-add` visual —
  deliberately NOT given the `.char-btn` class itself, to avoid colliding with the existing
  delegated `.char-btn` + `.closest('.char-bench')` handler that would try
  `JSON.parse(undefined)` on it), `.char-mm-entry` (subtle copper accent on the accordion
  entry/header so it visually reads as a class-feature grant, not a purchasable esfera).

Result: `npm run validate` (0 errors), `npm run typecheck` (green), `npm test` (30/30, incl. the
pre-existing "Metamágica does NOT add to general magic budget" / "surfaces as a restricted
allowance" / "count = 2 at lvl5" cases from the rules-layer step), `node scripts/sanity-builder.js`
(29/29 — confirms `migrateCharacters` now seeds `metamagic: []` on legacy characters), `node --check
app.js` clean. New ad hoc jsdom smoke script (same technique as `sanity-builder.js`, not committed)
loads the real `app.js`/`src/rules.js`, creates a level-5 Feiticeiro (Sangue Feérico), calls
`setupCharacter()` + `renderCharacter()`, and dispatches real click events end-to-end: entry
appears collapsed at 0/2 → expand → bench lists metaesfera candidates → select+add pick #1 (lands
in `char.metamagic`, X/N → 1/2, general magic budget unchanged) → add pick #2 (2/2) → 3rd candidate's
`.char-mm-add` is disabled ("Cota cheia") and clicking it is a no-op → dedupe both directions
(acquired Universal normally, confirmed a Metamágica pick isn't offered as an extra there; took a
different metaesfera talent as a normal Universal extra, confirmed it disappears from the
Metamágica bench) → remove (✕) takes it out of `char.metamagic`, X/N back to 1/2, and the removed
talent reappears as a bench candidate → level-1 Feiticeiro (no feature) shows no entry at all.
26/26 assertions passed. Full manual browser click-through still needed — see REVIEW-REQUEST.md.

Decisions made:
- `.char-mm-add` deliberately does NOT carry the `.char-btn` class (brief said it "pode reusar o
  visual de `.char-btn.char-bench-add`", read as CSS reuse, not class reuse) — `.char-mm-add` sits
  inside `.char-bench`, and the pre-existing delegated handler `cbtn.closest('.char-btn') &&
  cbtn.closest('.char-bench')` calls `applyTalentToggle(active, title, JSON.parse(cbtn.dataset.char),
  ...)`; a `.char-mm-add` button has no `dataset.char` (it only has `dataset.id`), so sharing the
  class would throw on click. CSS reuses the `.char-btn.char-bench-add` declaration by adding
  `.char-mm-add` to its selector list instead.
- Kept the search input in `buildMetamagicBenchPanel` even though the brief's toolbar description
  only mentions the label — it's the same `.char-bench-search` element already wired to the
  existing `input` listener (`refreshCharBench`), costs nothing extra, and is consistent UX with
  the normal talent bench. Flagging in case Richard/Arch wants it dropped for stricter brief
  fidelity.
- `metamagicAllowance(active)` returns `Rules.restrictedAllowances(active, dataIndex)[0] || null` —
  scope is 1 allowance today (per brief); if a second restricted feature is ever added, this
  becomes the seam that needs to grow into a keyed-by-feature lookup (not attempted here, out of
  scope).

Reviewer findings: pending — see `handoff/REVIEW-REQUEST.md`.
Deploy: pending

---

### Cloud Phase 2 — Mesa/campanha UI — BUILT (pending review)
*Date: 2026-07-09*

Core (rules + `src/cloud.js` + `firestore.rules` + `src/types.js` typedefs) was already done by Arch
on branch `cloud-tables` before this step started. This step is UI only: `app.js` + `style.css`,
consuming `window.Cloud.createTable/getTable` and the `cloud-my-tables`/`cloud-table-chars` events
exactly as shipped — 0 changes to `src/cloud.js`/`firestore.rules`.

Files changed:
- `app.js` —
  - **Share bar** (`buildShareBar`, only when `Cloud.isSignedIn()`, else an empty node): "Criar mesa"
    (prompt name → `Cloud.createTable` → `showCharNotice` with the code) + "Compartilhar por código"
    (prompt code → `Cloud.getTable`; `null` → `showCharNotice('Código de mesa inválido.')`) + chips for
    `char.sharedTables` with a ✕ (desexpor). New helpers `deriveSharedTo` (unique gmUids),
    `exposeCharToTable` (validates via `getTable`, dedupes by code, then `updateCharacter(id,
    {sharedTables, sharedTo})`), `unexposeCharFromTable` (filters + same). No dedicated Cloud method for
    expose/unexpose per the brief — it's a normal owner write, `pushCharacter` picks it up automatically.
    Wired into `renderCharacter()` right after `normalizeCharView` and into the existing delegated click
    listener in `setupCharacter` (`.char-share-create`/`.char-share-add`/`.char-share-remove`).
  - **Cache + routing**: `cloudMyTables`/`cloudTableChars` module-level arrays + `expandedMesaChars`
    (view-state `Set`, mirrors the accordion's expand/collapse pattern) — populated by two new
    `setupCloud` listeners (`cloud-my-tables`/`cloud-table-chars`) that re-render only when
    `location.hash === '#mesa'` (deliberately more precise than the pre-existing `currentChapterIndex
    === -1` checks on `cloud-auth`/`cloud-chars`, which conflate all four synthetic views — didn't touch
    those, just didn't copy the imprecision into new code). `navigate`/`handleInternalLinkClick` special-
    case list gets `#mesa` → `renderMyTable()`. Sidebar gets a "🏰 Minha mesa" link (`#toc-mesa-link`,
    `display:none` by default, toggled by `updateTableLinkVisibility()` called from `cloud-auth`).
  - **`renderMyTable()`** (+ `finishMesaRender()`, mirrors `finishCharRender()`): signed-out guard message
    when `!Cloud.isSignedIn()`; else per `cloudMyTables` entry, a `.mesa-table` section with a compact
    `.mesa-char-row` per `cloudTableChars` entry whose `sharedTables[].code` matches (name · class/
    subclass · level · `characterStats(char)` → CD/resource/attack). Click toggles `expandedMesaChars` +
    re-renders (full `renderMyTable()` — dataset is small, no incremental-patch complexity needed); when
    expanded, appends `renderSharedCharacterReadonly(char)`.
  - **`renderSharedCharacterReadonly(char)`** (+ `renderReadonlySpherePanel`): a **lean** render (per the
    brief's "ou monte um render enxuto" option, rather than pruning `renderSphereBuildPanel` in place,
    which bakes in the manage-controls block) reusing only display helpers that take `char` by parameter
    — `buildCharBudgetHTML`, `characterStats`, `charSphereTitles`, `grantedSpheresMap`, `sphereEntry`,
    `isGrantedSphere`, `getSphereModel`, `charTalentCard`. Base/granted/free talents render via
    `charTalentCard(fr, id, 'base'|'granted'|'free', title)` (already read-only, no ✕ for those kinds);
    extras render via `charTalentCard(fr, id, 'extra', title)` (to reuse the exact same card DOM) and
    then have their `.char-talent-remove` button stripped from the clone before it's appended — so no
    edit affordance ever reaches the DOM and no core helper needed a new "readonly kind" param.
    `char.metamagic` (if any) lists via the same `charTalentCard(..., 'free', ...)` pattern, sphere
    resolved from `metamagicAllowance(char)`. Never calls `getActiveChar()`/`updateCharacter`/any
    mutator — only reads the passed-in `char` (which for the GM comes straight off the
    `cloud-table-chars` event, never localStorage).
- `style.css` — `.char-share*` (share bar: reuses the `.acc-signin` button look + `.char-sphere-remove`'s
  outline-button pattern for chips) and `.mesa-*` (table/row/detail: reuses `.char-sphere-collapsed`'s
  row treatment for `.mesa-char-row`, `.char-rail-stats`/`.char-sphere`/`.char-cards` wholesale for the
  read-only sheet body — only the mesa-specific wrapper chrome is new).

Result: `npm run typecheck` (green), `npm test` (35/35, unchanged), `node scripts/sanity-builder.js`
(29/29, unchanged), `node --check app.js` clean. New ad hoc jsdom smoke script (same technique as
`sanity-builder.js`, not committed — lived in the scratchpad during the session) loads the real
`app.js`/`src/rules.js`, stubs `window.Cloud` (no live Firebase) and drives: signed-out guards (no share
buttons render, `buildShareBar` returns empty, `#mesa` shows the sign-in prompt with no tables) → signed-
in expose with a bad code (`ok:false` + message, no state change) → expose with a valid code (chip
appears, `sharedTables`/`sharedTo` persisted via `updateCharacter`/`getCharacters()`) → duplicate expose
is a no-op → two tables under the same GM still dedupe `sharedTo` to 1 uid → unexpose removes just that
entry and recomputes `sharedTo` → the REAL click → `prompt()` → `Cloud.getTable`/`Cloud.createTable` →
re-render wiring (not just the underlying functions) → `#mesa` populated from injected
`cloud-my-tables`/`cloud-table-chars` events shows the table name/code and a compact row with CD via
`characterStats` → click expands `renderSharedCharacterReadonly` (shows the sphere + an extra talent,
confirms zero `.char-btn`/`.char-sphere-manage`/`.char-talent-remove`/`.char-sphere-remove` anywhere in
the sheet, confirms rendering another user's character touched no `localStorage` character) → click again
collapses → sidebar link visibility flips with `updateTableLinkVisibility()`. 27/27 assertions passed.
Full manual 2-Google-account browser click-through still needed — see `handoff/REVIEW-REQUEST.md`.

Decisions made:
- Used `prompt()`/existing `showCharNotice()` toast for "nome da mesa"/"código da mesa" and the created-
  code readout — no modal component exists in the codebase yet; `confirm()` is already used the same way
  for character deletion, so this stays consistent with existing UX rather than introducing new UI
  machinery for a Builder-scoped step.
- `renderMyTable()`/row-toggle does a full re-render on every expand/collapse rather than an incremental
  patch (unlike the talent bench's `refreshCharBench`) — the GM's table/character counts are expected to
  be small, and a full render keeps this step simple; flagging in case Richard wants the patch-based
  pattern for consistency instead.
- `cloud-my-tables`/`cloud-table-chars` re-render gated on `location.hash === '#mesa'` rather than reusing
  `currentChapterIndex === -1`, since that sentinel is shared by 4 different synthetic views (favoritos/
  glossário/personagem/mesa) and would otherwise yank a GM looking at Favoritos over to `#mesa` (or vice
  versa) on an unrelated cloud event — pre-existing imprecision in the `cloud-auth`/`cloud-chars`
  listeners was left as-is (out of scope for this step) but not copied into the new listeners.

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
- **KG-4 — RESOLVED 2026-07-08** (branch `kg4-criacao-magias`, Arch inline, Richard SHIP). Depth-aware
  name parse (`lastTopParen`/`dualSpherePrereqs` in the extractor) now tags + enforces all 33 "esfera
  dupla" talents' required spheres (+ nested specific talents); package gate `requires`
  (`minMagicSpheresExcludingSelf:2`) blocks choosing Criação de Magias with <2 magic spheres
  (`Rules.packageRequirementMet` + selector/`setPackage`); general untagged Universal talents (Contrafeitiço,
  Foco Místico, Pacote Universal, the 4 "Extremo") are available under any package (`talentRole` +
  `allPackageTags`/`allPackageBaseIds`). Global fix also cleaned ~46 nested-paren talent ids across
  spheres (id churn accepted by Owner; non-destructive). Original scope below, for reference:

- **KG-4 (P2 follow-up, original)** — Universal's **Criação de Magias** package has stricter, unmodeled rules:
  (a) access requires the character to already have ≥ 2 other magic spheres; (b) its free (esfera dupla)
  pick must satisfy that talent's OWN multi-sphere prerequisites — the two spheres it names + any specific
  talent — which are encoded only in the talent's name/tags (e.g. "Transformar Objeto (esfera dupla,
  Alteração, Aprimoramento (Animar Objeto))" ⇒ needs Alteração + Aprimoramento spheres + the Animar Objeto
  talent), not in the structured `prerequisites`. Deferred per Owner. Needs: a package-access prereq
  (N spheres of a section) + parsing (esfera dupla) talents' dependencies into structured prereqs.
  Related minor open item: whether Universal's general/untagged talents (Contrafeitiço, Foco Místico,
  Pacote Universal, the "Extremo" advanced ones) should be pickable regardless of the chosen package
  (currently `talentTags` scopes them out).

- **KG-5 (Metamágica — restricted allowance)** — STATUS: rules layer + UI both BUILT (pending
  Richard's review — see the KG-5 step above). `Rules.restrictedAllowances` surfaces the N picks
  as a cost-0 allowance scoped to Universal's `metaesfera` tag (never inflates the general magic
  budget); the builder now shows a dedicated "✦ Metamágica — X/N" accordion entry with a bench for
  picking/removing. Leaving this entry until Richard/Arch formally close it.

---

## Architecture Decisions
*Locked decisions that cannot be changed without breaking the system.*

- The character builder consumes structured `data/` ONLY; no game rule is decided by a DOM heuristic — 2026-07-05
- Structured data is canonical for mechanics; `content/*.txt` remains the reading source until Phase 5 — 2026-07-05
- Homebrewery round-trip is retired; content may be restructured freely — 2026-07-05
- Browser stays zero-dep/no-build; Node tooling is dev-only — 2026-07-05
