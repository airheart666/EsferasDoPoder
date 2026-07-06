# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Phase 3 Step 4 — Wire the character builder to the structured rules engine

**Goal:** the builder makes every RULE DECISION from the structured data layer (never the DOM),
and BLOCKS illegal picks. Card *display* keeps cloning rendered HTML cards for now (Phase 5 will
render from structured `body` — do NOT do that here).

### What already exists (use it, don't rebuild)
- `data/spheres/*.json` — 1596 talents. Shape in `schema/talent.schema.json` / `schema/sphere.schema.json`.
  Talent: `{id,name,sphere,section,kind:'base'|'talent',group,tags[],cost{base,tiers,text},action,range,
  duration,target,area,save,prerequisites[{type:'talent'|'sphere'|'level'|'text',id?,min?,text?}],advanced,
  enhancements[],body}`. Sphere: `{id,name,section,summary,theme,acquisition{freeGroup,freeLabel,freePicks,
  talentTags,conditionals,packages},talents[]}`. `data/spheres.json` = manifest `[{id,name,section}]`.
- `data/classes.json`, `data/class-features.json` — class-features grants now carry a resolved talent `id`.
- `src/rules.js` — PURE engine, global `Rules` (also module.exports). Functions:
  `indexData(spheres,classes,classFeatures)→DataIndex`; `derivedStats(char,idx)`; `talentBudget(char,idx)→
  {magic,martial,notes}`; `slotsSpent`; `grantedSphereIds`; `accessedSphereIds`; `ownedTalentIds`;
  `prereqCheck(char,talent,idx)→{ok,missing[],unverified[]}`; `canAddTalent(char,talent,idx)→{ok,prereq,
  budgetOk,remaining,section}`; `canAccessSphere(char,sphereId,idx)→{ok,granted,remaining,section}`.
  Rules Character shape: `{id,name,className,subclass,level,keyMod,tradition,proficiencies:{skills[],tools[]},
  spheres:[{sphere:<sphereId>,section,choices,freePicks:[<talentId>],talents:[<talentId>]}]}`.
- `src/data.js` — global `DataLoader.loadData()→Promise<{spheres,classes,classFeatures}>` (browser fetch).
- Tooling: `npm run validate`, `npm run typecheck` (checkJs, src/ only), `npm test` (rules smoke). Keep all green.

### Current builder seams in app.js (read these before changing)
- Root-JSON loads → `classesData/sphereRules/classFeatures/sphereThemes` (init, ~lines 59–81).
- `getSphereModel(title,pkg)` ~1417 → scrapes DOM via `buildChapterCardFrag` ~1007 + `cardRole` ~1389;
  returns `{bases,freeGroup,extras,freeLabel,roleByKey,frag}`. `classSpec` ~1359 / `resolveSpec` ~1376 read
  `sphereRules`. `matchesFreeGroup` ~1346, `findCardInFrag` ~1443.
- `characterStats` ~1473, `classRow` ~1464, `traditionBonus` ~1499, `classFeatureBonus`, `grantedSpheresMap`
  ~1227 read `classesData`/`classFeatures`.
- Pick actions: `applyTalentToggle` ~825, `acquireSphere` ~1265, `toggleExtraTalent` ~1326.
- `renderCharacter` ~1570; `charTalentCard` ~1717 clones cards from `model.frag` (DISPLAY — KEEP).
- Character schema `createCharacter` ~1148; items are `{name,sphere,anchor,slug}`; `migrateCharacters` ~1841.

### Decisions (locked — do not deviate)
1. Rule decisions (which talents are base/free/extra, prereqs, budget, grants, derived stats) come from the
   structured `DataIndex` via `rules.js`. **Card display keeps cloning rendered cards** (`buildChapterCardFrag`
   + `findCardInFrag` stay, used ONLY to fetch card HTML for display; if no card matches, use the existing
   simple-link fallback at ~1727).
2. **Block illegal picks**: at the pick actions, call `Rules.canAddTalent` / `canAccessSphere`; if `!ok` due to
   unmet structured prereq (`prereq.missing`) or `!budgetOk`, abort and show a clear message (reuse `.char-warn`
   styling or a small inline notice). `prereq.unverified` (text prereqs) → allow but show a "confirm manually"
   note; never silently block on those.
3. **Character state → talent ids.** `char.spheres[].freePicks` and `.talents` become arrays of talent ids.
   Extend `migrateCharacters` to upgrade existing saved characters: for each stored `{name,sphere,...}` item,
   resolve to a talent id by `sphere`+normalized base name against the DataIndex; if unresolvable, keep the old
   item shape and flag it (don't drop user data). Granted talents/spheres are recomputed from class-features by
   id (already in data), never stored.
4. Browser wiring: add `<script src="src/rules.js"></script>` and `<script src="src/data.js"></script>` in
   `index.html` BEFORE `app.js` (classic scripts share global scope → `Rules`/`DataLoader` available). No bundler,
   zero new runtime deps. Load the data at startup (await `DataLoader.loadData()` → `Rules.indexData(...)`);
   store the index in a module global (e.g. `dataIndex`). Handle load failure gracefully (the existing
   "dados não puderam ser carregados" path at ~1582).

### Build order (suggested)
1. `index.html` script tags + `app.js` startup: load data, build `dataIndex`.
2. Reimplement the read side on top of `rules.js`: `characterStats`, budgets, `grantedSpheresMap`, and a new
   structured `getSphereModel` that returns roles (base/free/extra) from `sphere.acquisition` + talents, while
   still attaching display cards from `buildChapterCardFrag` (match structured talent → rendered card by name).
3. Character state → ids: `createCharacter`, `acquireSphere`, `applyTalentToggle`, `toggleExtraTalent`,
   `sphereEntry`, and `migrateCharacters`.
4. Enforcement in the three pick actions.
5. Manual test (see DoD) + write `handoff/REVIEW-REQUEST.md`.

### Flags (do not guess — ask Arch if unsure)
- Do NOT touch `content/*.txt`, `parser.js`, `chapters.js`, or the reader render path.
- Do NOT render talent cards from structured `body` (Phase 5).
- Do NOT lose saved characters — migration must be non-destructive.
- The Favorites (⭐) feature is separate from the character sheet; keep it working with minimal change.
- Keep `npm run validate`, `npm run typecheck`, `npm test` green. (app.js is not yet in typecheck scope.)

### Definition of Done
- [ ] No rule decision reads the DOM; only card display does. Data loaded via `DataLoader`+`Rules.indexData`.
- [ ] Adding an advanced talent without its prereq is BLOCKED with a message; over-budget picks BLOCKED.
- [ ] Granted spheres/talents (by id) and free-pick classification come from structured data and are correct.
- [ ] Existing saved characters migrate to ids with no data loss.
- [ ] Reader visually unchanged; `npm run validate` + `typecheck` + `test` all green.
- [ ] `handoff/REVIEW-REQUEST.md` written: files changed, key logic, and what Richard should scrutinize.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

Brief confirmed complete — no blocking ambiguity found. Key facts verified against real data
before coding (all via read-only Node checks, no files changed):
- `data/classes.json` / `data/class-features.json` are byte-identical to the root
  `classes.json` / `class-features.json` except `class-features.json` grants now carry a
  resolved talent `id`. Root `sphere-rules.json` is byte-identical (as JSON) to each sphere's
  `acquisition` field for all 42 spheres (0 mismatches). So the root `classesData`/`classFeatures`/
  `sphereRules` fetches become fully redundant with `dataIndex` and will be removed, not
  duplicated.
- `slug(sphereTitle) === sphere.id` for all 42 spheres (0 mismatches) — confirms
  `Rules.grantedSphereIds` (which slugs the class-features `sphere` title) lines up with the
  real sphere ids once `char.spheres[].sphere` stores ids.
- Structured `talent.tags`/`talent.group` are already the same normalized/raw values the DOM
  `sphereTags()`/`dataset.group` used — the new structured free/base/extra classifier can port
  `cardRole`'s logic 1:1 reading the Talent object instead of the card.
- Homonym talents (e.g. Conjuração's base "Invocação" vs the advanced "Invocação") get distinct
  ids in the data (`conjuracao-invocacao` vs `conjuracao-invocacao-2`); disambiguated via the
  DOM's `.base-ability` class (set by `enhanceTalents` step 3, same semantic as `kind:'base'`).

### Design
1. **`dataIndex` global.** `init()` replaces the `classes.json`/`sphere-rules.json`/
   `class-features.json` fetches with `DataLoader.loadData()` → `Rules.indexData(...)` → module
   global `dataIndex`; also builds `sphereIdByTitle`/`sphereTitleById` (Map, from
   `dataIndex.sphereById`) since chapter titles ("Vida") are the UI key everywhere but Rules
   Character state keys spheres by id ("vida"). Load failure → `dataIndex = null`, everything
   degrades to the existing "dados não puderam ser carregados" path.
2. **Persisted character shape changes** (this is the risky part): `char.spheres[].sphere`
   becomes the sphere id (not title); `.freePicks`/`.talents` become arrays of talent id strings
   (not `{name,sphere,anchor,slug}` objects). This matches `src/types.js` `CharSphere` exactly, so
   `char` can be passed straight into `Rules.*` with zero adapter. UI code keeps taking `title`
   as its parameter (chapter title, unchanged everywhere) — `sphereEntry`/`acquireSphere`/etc.
   convert title→id internally via `sphereIdByTitle`.
3. **`getSphereModel(title,pkg)` rewritten** to iterate `sph.talents` (structured) instead of
   scraping `buildChapterCardFrag`, classifying base/free/extra from `sph.acquisition` +
   `talent.tags/kind/group` (port of `cardRole`/`matchesFreeGroup`/`sphereTags` logic, reading
   the Talent object instead of the DOM). It still calls `buildChapterCardFrag` once and stores
   `model.frag` — used ONLY by `charTalentCard`/`findCardInFrag` to clone the matching rendered
   card for display. `classSpec` reads `sph.acquisition` instead of `sphereRules[title]`.
   `cardRole`/`matchesFreeGroup`/`sphereTags` (DOM-based) are retired — the 3 call sites
   (`refreshSphereUI`, `addFavoriteStars`, `applyTalentToggle`) switch to resolving the DOM
   card's talent id (name + `.base-ability` for homonyms) and reading `model.roleByKey`, with
   the existing granted-sphere override kept on top (character-specific, not sphere-intrinsic).
4. **Pick actions gain enforcement.** New `addFreePickChecked`/`addExtraTalentChecked` wrappers
   call `Rules.prereqCheck`/`Rules.canAddTalent` before mutating state; a new `tryAcquireSphere`
   wraps `Rules.canAccessSphere` before `acquireSphere`'s create path. On block: a transient
   `.char-warn` notice (new `showCharNotice(anchorEl, message)` helper, auto-dismiss) — reusing
   the existing style, not a new pattern. `prereq.unverified` (text prereqs) never blocks; shows
   a "confirm manually" notice instead. Removal paths are never gated (only additions).
5. **Read side delegates to `rules.js`.** `characterStats`→`Rules.derivedStats`,
   `traditionBonus`→`Rules.traditionBonus`, `classFeatureBonus`→`Rules.classFeatureBonus`, and
   `renderCharacter`'s used/budget numbers → `Rules.slotsSpent`/`Rules.talentBudget`. App.js keeps
   its own title-keyed `grantedSpheresMap` (for the "which specific talents does the subclass
   grant" display, which `rules.js` doesn't model) sourced from `dataIndex.classFeatures`
   directly instead of the old root `classFeatures` global — same shape, now carries the
   talents' `.id`.
6. **Migration (non-destructive).** `migrateCharacters()` gains a pass per sphere entry: title→id
   (only if resolvable via `sphereIdByTitle`; otherwise the entry keeps its old title, flagged
   `_needsReview`), and each `freePicks`/`talents` item: already-a-string → keep; object →
   resolve to a talent id by exact name match within the resolved sphere (unique match only,
   homonyms are intentionally left unresolved rather than guessed); unresolvable objects are
   moved to a new `entry._unresolvedLegacy` array (kept, not dropped) and a small notice is
   rendered in the character sheet + `console.warn`'d so nothing silently vanishes. Runs only
   when `dataIndex` loaded successfully; otherwise no-ops (retries next successful load).
7. **`index.html`**: add `src/data.js` + `src/rules.js` `<script>` tags before `app.js`.
8. **Verification**: `npm run validate` / `typecheck` / `test` (none touch app.js, so should be
   unaffected by construction — will confirm). Browser click-through isn't possible from here; I
   will add a Node-level sanity script (loads real `data/*`, feeds a couple of synthetic
   characters through the same enforcement helpers conceptually via `Rules.*` directly) as far as
   is practical without a DOM, and will clearly flag what still needs manual browser testing in
   `REVIEW-REQUEST.md`.

### Explicitly out of scope / accepted gaps (flagging, not asking — none are blocking)
- `Rules.ownedTalentIds` does not yet fold in class-features-granted *specific* talents (only
  granted sphere access + base talents + chosen picks) — `rules.js` itself documents this as a
  future step. Consistent with today's behavior (granted specific talents never cost a slot or
  count as "owned" for prereqs either, before or after this change) — not a regression, just a
  known limitation of the frozen `rules.js` API. Not extending `rules.js` per "use it, don't
  rebuild."
- Homonym talents in legacy (pre-id) saved data with no disambiguating signal are left
  unresolved (flagged) rather than guessed — affects at most 1-2 spheres, only for characters
  saved before this change shipped.

No open questions — proceeding to build.

Architect approval: [ ] Approved / [ ] Redirect
