# Review Request — Phase 3 Step 4
*Written by Builder (Bob). Read by Reviewer (Richard).*

Ready for Review: YES

---

## What Was Built

Wired the character builder in `app.js` to the structured rules engine (`src/rules.js` +
`src/data.js` over `data/spheres/*`, `data/classes.json`, `data/class-features.json`) so that
every RULE decision — free/base/extra classification, talent-slot budget, prerequisites, granted
spheres/talents — comes from structured data, never the DOM, and illegal picks (unmet structured
prerequisite, exhausted talent-slot budget) are now **blocked** with a message instead of silently
allowed. Card *display* is unchanged: it still clones the rendered HTML card for the matching
talent (Phase 5 will render from structured `body`, not this step). The persisted character shape
changed to store sphere/talent **ids** instead of titles/name-objects (matches `src/types.js`
`CharSphere` exactly), with a non-destructive migration for existing saved characters.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `index.html` | 129-133 | Added `<script src="src/rules.js">` + `<script src="src/data.js">` before `app.js` (classic scripts, shared global scope). |
| `style.css` | 1419 | One rule for the new transient `.char-warn-toast` block-notice. |
| `app.js` | 3-11 | Globals: removed `classesData`/`sphereRules`/`classFeatures`; added `dataIndex`, `sphereIdByTitle`, `sphereTitleById`. |
| `app.js` | init() (~60-70) | Replaced the 3 root-JSON fetches (`classes.json`, `sphere-rules.json`, `class-features.json`) with `DataLoader.loadData()` → `Rules.indexData()`. Failure → `dataIndex = null`, same degrade path as before (renderCharacter's "dados não puderam ser carregados"). |
| `app.js` | ~551-582 (new) | `sphereIdFor`/`sphereByTitle` (title↔id bridge), `resolveTalentId`/`resolveTalentIdLoose` (DOM card / legacy name → talent id), `showCharNotice` (transient block-notice). |
| `app.js` | `makeCharControl`, `addFavoriteStars`, `refreshSphereUI` | Membership checks (`favKey`-based) → `item.id`-based `.includes()`; role classification now via `cardDisplayRole(model,...)` (structured) instead of `cardRole(card, cs, gc)` (DOM). |
| `app.js` | `applyTalentToggle` + new `addFreePickChecked`/`addExtraTalentChecked` | Core enforcement: resolves `item.id` → structured `Talent`, calls `Rules.prereqCheck`/`Rules.canAddTalent`; blocks + `showCharNotice` on failure. Removal is never gated. |
| `app.js` | `showCharPicker`, `setupFavorites` (acquire-btn / freepick-select handlers) | Same id-based membership checks; `.acquire-btn` now goes through new `tryAcquireSphere` (gates on `Rules.canAccessSphere`); `.freepick-select` now runs `Rules.prereqCheck` before `setFreePickAt`. |
| `app.js` | `grantedSpheresMap`, `isGrantedSphere`, `grantedKeys`, `isGrantedTalent` | Same title-keyed shape as before, now sourced from `dataIndex.classFeatures` (structured, ids included) instead of the root `classFeatures` global. |
| `app.js` | `sphereEntry`, `acquireSphere` (+ new `tryAcquireSphere`), `removeSphere`, `sphereCost` | Convert title→id via `sphereIdFor`; `acquireSphere` stores `sphere:<id>` + structured `section`; `tryAcquireSphere` is the new enforced entry point for the "Adquirir esta esfera" action. |
| `app.js` | `setFreePickAt`, `addFreePick`, `removeFreePick`, `toggleExtraTalent` | Now operate on talent **id strings** (were `{name,sphere,anchor,slug}` objects) — plain array mutations, no more `favKey` comparisons. |
| `app.js` | `classSpec` | Reads `sph.acquisition` (structured) instead of root `sphereRules[title]` — confirmed byte-identical for all 42 spheres before switching (see Open Questions/verification below). `resolveSpec` unchanged (built on `classSpec`). |
| `app.js` | `talentRole` (new, replaces `cardRole`+`matchesFreeGroup`+`sphereTags`), `cardDisplayRole` (new) | Structural base/free/extra classification now reads `talent.tags`/`kind`/`group` directly; `cardDisplayRole` bridges a DOM card (name + `.base-ability`) to a talent id, looks up its structural role, and layers the character-specific "granted by subclass" override on top — same precedence as the old `cardRole` (ignore > base > granted > free/extra). |
| `app.js` | `getSphereModel` | Rewritten to iterate `sph.talents` (structured) for classification; still calls `buildChapterCardFrag` once for `model.frag`, used only by `charTalentCard`/`findCardInFrag` to clone the display card. |
| `app.js` | `findCardInFrag` | Now takes a structured `Talent` (was a DOM-derived `item`); disambiguates homonyms via `talent.kind==='base'` ⟺ card's `.base-ability` class (was: DOM section-anchor matching). |
| `app.js` | `characterStats`, `traditionBonus`, `classFeatureBonus` | Now thin delegations to `Rules.derivedStats`/`traditionBonus`/`classFeatureBonus`. `traditionField` reads `dataIndex.classes` instead of `classesData`. |
| `app.js` | `renderCharacter` | Budget numbers via `Rules.slotsSpent`; `classesData` references → `dataIndex.classes`; `charTalentCard` rewritten to take a talent id (or, for unmigrated legacy data, the kept `{name,...}` object) instead of an item object; per-sphere loop fixed to map `entry.sphere` (id) back to a title via `sphereTitleById` for display; renders a `.char-warn` note listing any `_unresolvedLegacy` items for that sphere. |
| `app.js` | `migrateCharacters` | Extended: converts `char.spheres[].sphere` title→id (unresolvable → kept, flagged `_needsReview`); converts each `freePicks`/`talents` item → talent id by exact-name match within the resolved sphere (ambiguous homonyms intentionally left unresolved rather than guessed); unresolvable items move to `entry._unresolvedLegacy` (never dropped). No-ops entirely if `dataIndex` didn't load (retries next successful load). |
| `scripts/sanity-builder.js` | new file, not wired into `package.json` | Node-level integration check (see Verification). |

## How This Was Verified

- `npm run validate` — 0 errors (unaffected; doesn't touch app.js).
- `npm run typecheck` — green (unaffected; scoped to `src/**/*.js`, app.js not in scope).
- `npm test` (`scripts/test-rules.js`) — 12/12, unaffected (pure `src/rules.js` test).
- **New:** `node scripts/sanity-builder.js` — 23/23 assertions. This loads the *real*
  `parser.js`/`chapters.js`/`src/rules.js`/`src/data.js`/`app.js` into a jsdom context (via
  `vm.runInContext`, real functions, not reimplemented) with a `fetch` stub that serves the real
  files off disk, parses the real `content/*.txt`, and drives:
  - an advanced Mente talent with structured prereqs: **blocked** with no prereqs met, then
    **allowed** once the prereq talents/level are granted directly on the character;
  - talent-slot budget: fills a level-1 Feiticeiro's remaining magic slots with legal picks, then
    the next legal-looking pick is **blocked**;
  - sphere-access budget: same, via `tryAcquireSphere`;
  - a subclass-granted sphere (Sangue Feérico → Mente) costs 0 and re-acquiring is a no-op;
  - migration: a synthetic **old-shaped** character (`spheres[].sphere` = title,
    `freePicks`/`talents` = `{name,sphere,anchor,slug}` objects, one resolvable + one intentionally
    bogus name) migrates to ids correctly, the bogus one lands in `_unresolvedLegacy` (not
    dropped, not silently lost), and re-running migration is idempotent.
  - This script is standalone (`node scripts/sanity-builder.js`), not wired into `npm test` — it's
    a slower jsdom-based integration check, not a fast unit test; happy to wire it in if you'd
    rather it run every time.
- Before writing the structured-data reads, I verified with throwaway Node scripts (not committed)
  that: `data/classes.json`/`data/class-features.json` are byte-identical to the root files except
  `class-features.json` grants now carry a resolved talent `id`; `sphere-rules.json` is
  byte-identical (as JSON) to each sphere's `acquisition` for all 42 spheres; `slug(sphereTitle) ===
  sphere.id` for all 42 spheres.

## What Still Needs Manual Browser Testing

I cannot click through a browser from here, so please exercise at least:
1. Open the app, create a character, pick a class/level, **acquire a sphere**, confirm the
   acquire bar/free-pick selects/package selects still render and behave.
2. Click **+** on a base-ability card (should show the "included" chip, not a button), on a
   free-group talent (should go grátis, no slot cost), on a plain talent (should cost a slot).
3. Try to add an **advanced talent whose prerequisite isn't met** — expect it to be blocked and a
   notice to appear (styled like `.char-warn`, near the card/button), and the character state to
   NOT change.
4. Exhaust the talent-slot budget, then try to add one more — expect block + notice.
5. Pick a class/subclass combo that grants sphere access (e.g. Feiticeiro → Sangue Feérico) —
   confirm the granted sphere shows "concedida" and its granted talents show the "concedido" chip
   with no cost.
6. **Most important**: if you (or anyone) has an existing saved character in `localStorage` from
   before this change, load the app and confirm the character still appears intact with the right
   talents (this exercises the real migration path against real prior browser state, which
   `sanity-builder.js` can only approximate with a synthetic fixture). Check the browser console
   for the `[Esferas]` migration warning — it should only appear if something is genuinely
   unresolvable, and should list exactly what.
7. Confirm the reader (non-character pages) looks and behaves identically to before — I did not
   touch `content/*.txt`, `parser.js`, `chapters.js`, or any reader-render function; the only
   shared surface is the two new `<script>` tags in `index.html` and one new CSS rule.

## Open Questions / Judgment Calls

- **`Rules.ownedTalentIds` gap (KG-2 in BUILD-LOG)**: class-features-granted specific talents
  (e.g. Alquimista's "Revitalizar") aren't folded into `ownedTalentIds`/prereq-satisfaction, per
  `rules.js`'s own documented limitation. This matches pre-existing behavior (those talents never
  cost a slot or counted as "owned" before this step either) — not a regression, but flagging in
  case you want to scope a small `rules.js` extension for it later (I left `rules.js` untouched
  per the brief's "use it, don't rebuild").
- **Homonym talents in legacy saves (KG-3)**: only 1-2 spheres have a same-named base + advanced
  talent (e.g. Conjuração's "Invocação"); a saved-but-unmigrated pick of the homonym can't be
  auto-resolved from name alone (no DOM `.base-ability` signal available during migration) and
  lands in `_unresolvedLegacy` instead of guessing. I judged "flag and ask the player to re-add"
  safer than a possible silent misassignment. Worth a second opinion given it touches user data.
- I removed the root-level `classes.json`/`sphere-rules.json`/`class-features.json` **fetches**
  from `app.js` init() (they're now redundant with `dataIndex`). Confirmed these files must stay:
  `scripts/extract-structured.js` still reads them as the canonical *source* it migrates into
  `data/classes.json`/`data/class-features.json`, and `scripts/test-rules.js` loads them directly
  too — only the browser's own fetch of them became redundant, not the files themselves.

## Known Gaps Logged

See `handoff/BUILD-LOG.md` → Known Gaps (KG-2, KG-3), both described above.
