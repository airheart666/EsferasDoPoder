# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Phase 3 — Character builder on structured data + rules engine

### Decisions (locked)
- **Build-time constraint = talent slots**, not PM. Budget = `progression.magicTalents`/`martialTalents`
  (by level) + tradition bonus (if class type matches) + class-feature `bonusByLevel`. Sphere access and
  each extra talent cost 1 slot; subclass-granted access costs 0. Magic and martial budgets are separate.
- **PM is a derived casting pool** (`progression.pm`), displayed, never spent at build time.
- **Enforcement blocks** (Owner chose full rules engine): illegal picks are rejected, not just warned.
  Structured prerequisites (`talent`/`sphere`/`level`) are enforced. `text` prerequisites (OR-alternatives,
  descriptive, package refs — see data/CURATION-NOTES.md) are **unverifiable**: surfaced to the user as
  "confirm manually", never silently block or silently pass.
- The builder reads `data/spheres/*` exclusively. No DOM scraping. `getSphereModel`/`cardRole`/`classSpec`/
  `matchesFreeGroup`/`findCardInFrag` in app.js are replaced by structured-data lookups.
- Character state stores talent references by stable **id** (not `{name,anchor,slug}`); add a
  `migrateCharacters` upgrade step (pattern at app.js:1841).

### Build order
1. `src/rules.js` — pure, typed rules engine (no DOM). Index data; derived stats; talent-slot budget;
   owned-talent/accessed-sphere sets; prereq check; canAddTalent/canAccessSphere. **[this step]**
2. Migrate `classes.json` + `class-features.json` into `data/`; add talent `id`s to grants (extend the
   extractor or a small script) so granted talents resolve by id.
3. `src/data.js` — browser loader (fetch data/spheres + classes + class-features), same shape as the
   Node loader used by tests.
4. Rewire app.js builder to call rules.js; migrate character state to ids; block illegal picks in the UI.
5. Reviewer pass (Richard) — this changes running code; deploy-gate before any merge to master.

### Flags
- Granted-talent-by-id needs step 2 (class-features migration) — step 1 does budget + self-pick prereqs
  and leaves a clean seam for grants.
- Do NOT change `content/*.txt` or the reader pipeline in Phase 3 (reader stays on prose until Phase 5).

### Definition of Done (Phase 3)
- [ ] `src/rules.js` typed, `npm run typecheck` green, smoke test passes on real data.
- [ ] Builder blocks: advanced talent without its prereq, and over-budget picks.
- [ ] Character state is id-based; old characters migrate without data loss.
- [ ] Reader unchanged; `npm run validate` still green.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

Step 1 implemented directly by Architect (pure logic, high design sensitivity). Steps 2–4 are the
mechanical/wiring bulk — candidates for Builder once the engine contract is proven by the smoke test.

Architect approval: [x] Approved — proceeding with step 1.
