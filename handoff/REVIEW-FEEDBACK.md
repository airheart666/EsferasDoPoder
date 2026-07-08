# Review Feedback — KG-5: Metamágica restricted allowance

*Written by Reviewer (Richard). Read by Owner and team.*

**Date:** 2026-07-07  
**Verdict:** **SHIP** — zero blockers; minimal out-of-scope housekeeping flagged below.

---

## Executive Summary

The rules layer and UI layer are both correct. `restrictedAllowances` computes the Metamágica allowance accurately; `classFeatureBonus` properly excludes it from the magic budget; `ownedTalentIds` includes the metamagic picks so they satisfy prerequisites; and the UI handles expansion/collapse, cap enforcement, two-way dedup, and state resets cleanly. All 30 tests pass. Implementation matches the brief exactly.

---

## Rules Core (`src/rules.js`, `schema/class-features.schema.json`, `data/class-features.json`)

### `classFeatureBonus(char, idx)` — lines 113–117
**Status:** ✓ Correct

- Features with `restrictedTo` are identified and skipped from the budget accumulation.
- The note is still surfaced (`f.note` pushed to `out.notes`), so users see the mechanic explanation.
- Non-restricted features continue to work as before.
- **Test assertion:** `"Metamágica does NOT add to general magic budget"` — PASS (cfb.magic === 0 for a Feiticeiro lvl5).

### `restrictedAllowances(char, idx)` — lines 128–156
**Status:** ✓ Correct

- Scans both class-level and subclass-level features for `restrictedTo` markers.
- Accumulates `bonusByLevel` up to `char.level` (cumulative sum).
- Returns `{feature, sphere, tag, count, note}[]`.
- **Test assertion:** `"Metamágica allowance count = 2 at lvl5 (cumulative bonusByLevel)"` — PASS (meta.count === 2).
- Count will correctly grow to 3 at level 10, 4 at level 17 (via bonusByLevel pairs in data).

### `ownedTalentIds(char, idx)` — line 289
**Status:** ✓ Correct

- Folds in `char.metamagic || []` as a final set union, alongside granted talents, freePicks, and package base abilities.
- Ensures any talent in `char.metamagic` is considered "owned" for prereq checks and dedup.

### Schema (`schema/class-features.schema.json`)
**Status:** ✓ Correct

- `restrictedTo` is a new object property with `additionalProperties: false` (strict).
- Declares `sphere` and `tag` as optional strings.
- Matches the structure used in `data/class-features.json`.

### Data (`data/class-features.json`)
**Status:** ✓ Correct

- Feiticeiro "Metamágica" feature replaced `"group": "talento (Meta) da esfera Universal"` with structured `restrictedTo: {sphere, tag}`.
- `bonusByLevel` remains `[[3, 1], [10, 1], [17, 1]]` (2 total at lvl 3–9, 3 at 10–16, 4 at 17+).
- The note is preserved.

---

## UI Layer (`app.js`, `style.css`)

### `METAMAGIC_KEY` Sentinel — line 28
**Status:** ✓ Correct

- Defined as `const METAMAGIC_KEY = 'mm:Metamágica'`; used as the value of `charView.sphere` when the Metamágica entry is expanded.
- Does not collide with any sphere title (starts with sentinel prefix).
- Enables reuse of the existing accordion expand/collapse machinery without a parallel state field.

### `buildCharBuildContent(active)` — lines 1923–1935
**Status:** ✓ Correct

- Checks `const mm = metamagicAllowance(active)` early; only shows the Metamágica entry if it is truthy.
- Appends either `renderMetamagicPanel(active, mm)` (expanded) or `buildCollapsedMetamagic(active, mm)` (collapsed) after the sphere entries.
- The early-return for "Nenhuma esfera ainda" now also checks `&& !mm`, so a Feiticeiro with the feature but zero spheres still sees the entry.

### `buildCollapsedMetamagic(active, allowance)` — lines 1938–1950
**Status:** ✓ Correct

- Mirrors `buildCollapsedSphere` exactly: `.char-sphere-collapsed` button, `data-sphere="mm:Metamágica"`, reuses the existing click handler.
- Displays "✦ Metamágica" (symbol) + `X/N escolha(s)` (count).
- The existing handler in `setupCharacter` will route METAMAGIC_KEY clicks to `charView.sphere = METAMAGIC_KEY` and call `refreshCharBench()`.

### `renderMetamagicPanel(active, allowance)` — lines 1953–2006
**Status:** ✓ Correct

- Container `section.char-sphere` reuses the `.closest('.char-sphere')` guards from P1/P2 (no regressions).
- Header `h3.char-sphere-title.char-sphere-toggle` with `data-sphere="mm:Metamágica"` reuses the existing toggle handler.
- Cards for chosen talents: calls `charTalentCard(model.frag, id, 'free', 'Universal')` with `kind='free'` (shows "grátis" tag).
  - Manually adds `.char-talent-extra` class for flex layout.
  - Creates a separate `.char-mm-remove` button (NOT `.char-talent-remove`, which would call the wrong handler).
  - Correctly inserts the button before the card content.
- Shows a hint line while `picks.length < count`.
- The note from the allowance is displayed.

### `metamagicAllowance(active)` — lines 1703–1709
**Status:** ✓ Correct

- Thin wrapper: `Rules.restrictedAllowances(active, dataIndex)[0] || null`.
- Scope is correctly limited to 1 today (Metamágica only); future features would need feature-keyed lookup (noted in brief, out of scope).

### `metamagicCandidates(active, allowance)` — lines 2164–2178
**Status:** ✓ Correct

- Filters by tag (`allowance.tag = 'metaesfera'`).
- Excludes via `Rules.ownedTalentIds`, which includes `char.metamagic` AND all normal Universal picks.
- Two-way dedup: a Metamágica pick can't be offered again here; a normally-bought Universal talent can't be offered here either.

### `talentCandidatesForSphere(active, title)` — line 1690
**Status:** ✓ Correct

- Added `...((active && active.metamagic) || [])` to the `owned` set.
- Ensures a talent taken by Metamágica doesn't reappear as a purchasable extra in the normal Universal talent list.
- The other half of the two-way dedup (reverse direction already covered by `metamagicCandidates` via `Rules.ownedTalentIds`).

### `buildMetamagicDetail(active, item, allowance)` — lines 2181–2224
**Status:** ✓ Correct

- Mirrors `buildTalentDetail` layout: name/meta/description (cloned from `findCardInFrag`).
- Button is `.char-mm-add` (NOT `.char-btn` — see decision below).
- `dataset.id` only (no `dataset.char`); `dataset.sphere` not needed (allowance sphere is fixed).
- Disabled and labeled "Cota cheia" when `char.metamagic.length >= allowance.count`.

### `.char-mm-add` Class Decision — NOT `.char-btn`
**Status:** ✓ Correct & Well-Justified

**Why this is right:**
- The pre-existing delegated handler looks for `cbtn.closest('.char-btn')` and calls `applyTalentToggle(active, title, item, cbtn)` with `JSON.parse(cbtn.dataset.char)`.
- A `.char-mm-add` button only has `dataset.id` (no `dataset.char`/`dataset.sphere`).
- If `.char-mm-add` had the `.char-btn` class, clicking it would crash on `JSON.parse(undefined)`.
- By explicitly omitting `.char-btn`, the Metamágica handler (which comes after in the same listener) is guaranteed to match first via `.char-mm-add` and never route through `applyTalentToggle`.

**CSS reuse (correct approach):**
- The stylesheet combines `.char-btn.char-bench-add, .char-mm-add` selectors (line 2025) to share the button visual.
- No class duplication; clean separation of handler responsibilities.

### `buildMetamagicBenchPanel(active, allowance)` — lines 2227–2264
**Status:** ✓ Correct

- Reuses master-detail shell (`.char-bench-li` + search + detail).
- Toolbar shows a single label (no scope chips, no "+ Adicionar esfera") as specified.
- Correctly delegates to `buildMetamagicDetail` for the detail panel.
- Search filter (`normalizeTerm`) works as in the normal bench.

### `buildTalentBenchPanel(active)` — lines 2269–2273
**Status:** ✓ Correct

- Early guard: if `charView.sphere === METAMAGIC_KEY`, calls `buildMetamagicBenchPanel(...)` and returns (never falls into the normal esfera/scope path).
- The existing sphere-based talent list is untouched.

### Cap Enforcement — Belt-and-Suspenders
**Status:** ✓ Correct

**In the UI (preventive):**
- `.char-mm-add` is disabled when `char.metamagic.length >= allowance.count` (line 2192 in buildMetamagicDetail).
- Button label changes to "Cota cheia".

**In the handler (defensive):**
- Line 2844: Early return if `mmAdd.disabled`.
- Line 2851: Re-checks `picks.length >= allowance.count` and `tagOk` before `updateCharacter`.
- Shows an error notice if the check fails.

### Two-Way Dedup Verification
**Status:** ✓ Correct

1. **Metamágica → Universal normal talents:**
   - `metamagicCandidates` excludes via `Rules.ownedTalentIds(active, dataIndex)`.
   - This set includes both `char.metamagic` (the Metamágica picks) and normal Universal extras.
   - ✓ A Metamágica pick can't be offered again in the Metamágica bench.

2. **Universal normal talents → Metamágica:**
   - `talentCandidatesForSphere(active, 'Universal')` now excludes `...((active && active.metamagic) || [])`.
   - ✓ A Metamágica pick won't reappear as a normal Universal extra.

3. **Reverse direction (normal extra → Metamágica):**
   - When a talent is bought as a normal Universal extra, it enters `active.spheres[universal].talents`.
   - Next render, `Rules.ownedTalentIds` includes it (line 278 of rules.js).
   - `metamagicCandidates` excludes it via that set.
   - ✓ A normal pick can't be chosen again as Metamágica.

### `normalizeCharView(active)` — lines 2462–2467
**Status:** ✓ Correct

- METAMAGIC_KEY is valid only while `metamagicAllowance(active)` returns truthy.
- If the feature disappears (level drops, subclass changes, etc.), the sentinel becomes invalid and `charView.sphere` resets.
- Mirrors the behavior of sphere removal.

### `migrateCharacters()` — line 2695
**Status:** ✓ Correct

- Seeds `char.metamagic = []` on legacy characters.
- Runs alongside other defaults (`proficiencies`, `tradition`, `subclass`).
- Marked `changed = true` so the localStorage update fires.

### Handlers (`setupCharacter`) — lines 2841–2867
**Status:** ✓ Correct

**`.char-mm-add` handler:**
- Line 2841: Finds the button via `.closest('.char-mm-add')`.
- Line 2844: Returns early if disabled or no active character.
- Line 2845–2846: Re-fetches the allowance (defensive).
- Line 2847–2850: Retrieves the talent and checks its tags.
- Line 2851: Final cap + tag check before mutation.
- Line 2852: Mutates via `updateCharacter` (same pattern as other add handlers).
- Line 2854: Full re-render (correct — syncs charView and UI state).

**`.char-mm-remove` handler:**
- Line 2859: Finds the button via `.closest('.char-mm-remove')`.
- Line 2864: Filters the id out of `active.metamagic`.
- Line 2865: Re-renders (same pattern as other remove handlers).

**No routing through `applyTalentToggle`:**
- Both handlers return early, so the existing talent-add logic is never reached for Metamágica.
- Reuses handlers for `.char-sphere-collapsed` (expand), `.char-sphere-toggle` (collapse), `.char-bench-li` (selection) — they are sphere-agnostic and work with METAMAGIC_KEY out of the box.

---

## CSS (`style.css`)

### `.char-mm-remove` Styling — lines 1427, 1432
**Status:** ✓ Correct

- Extends the selector for `.char-talent-remove` (same visual).
- Scoped variant for `.char-talent-extra > .char-mm-remove` (line 1725).
- Matches the removal button styling throughout.

### `.char-mm-entry` Styling — lines 1918–1919
**Status:** ✓ Correct

- Applies a copper accent (`var(--copper)`) to both the collapsed row and the expanded header.
- Visually distinguishes Metamágica from normal purchasable spheres (subtle but clear).
- Hover state: copper border and background tint (consistent with sphere entries).

### `.char-mm-add` Button Styling — lines 2025–2041
**Status:** ✓ Correct

- Combined selector with `.char-btn.char-bench-add` (CSS reuse, no duplication).
- Base, `:hover:not(:disabled)`, and `:disabled` states all correct.
- Matches the verdigris theme used by other add buttons.

### Dead CSS Removal — `.char-rail-addsphere` lines removed
**Status:** ⚠ **Out of scope, but harmless**

- This rule was added in Layout B (fbf7cbd) but has no references in the codebase.
- The KG-5 diff removes it as a cleanup (not part of the brief, but appropriate housekeeping).
- No functional impact; no regressions.
- **Recommendation:** Document in commit message that this is dead CSS from Layout B, not a Metamágica change.

---

## Testing & Verification

### Automated Tests
- **npm test:** 30/30 assertions PASS.
  - "Metamágica does NOT add to general magic budget" ✓
  - "Metamágica surfaces as a restricted allowance" ✓
  - "Metamágica allowance count = 2 at lvl5" ✓
  - All pre-existing tests (budget, prereqs, grants, etc.) still pass ✓

### Validation
- **npm run validate:** 0 errors (unaffected).
- **npm run typecheck:** Green (app.js is out of scope).
- **node scripts/sanity-builder.js:** 29/29 assertions PASS (migrateCharacters verified).
- **node --check app.js:** Clean syntax.

### Browser Click-Through (from REVIEW-REQUEST.md jsdom smoke test)
- 26/26 assertions passed in the hand-written integration test.
- Covers expansion/collapse, cap enforcement, dedup (both directions), removal, and state reset.
- Confirmed the general magic budget is NOT affected by Metamágica picks.

---

## Regressions Checklist

✓ **Sphere accordion** — `renderSphereBuildPanel`, `.char-sphere-collapsed`, `.char-sphere-toggle` handlers untouched.  
✓ **Bench (talents mode)** — Only one guard added at the top; normal talent list path unchanged.  
✓ **Bench (spheres mode)** — `buildSphereBenchPanel` untouched.  
✓ **P1 (granted sphere free picks)** — `.char-sphere-manage` and `.closest('.char-sphere')` guards byte-identical.  
✓ **P2 (Universal package selection)** — `.closest('.char-sphere')` guards untouched.  
✓ **Reading-page acquire bar** — Not touched.  
✓ **Dark mode** — New CSS rules respect `var(--copper)`, `var(--accent)`, etc.; no hardcoded colors.

---

## Minor Observations (Non-Blocking)

1. **Search box in Metamágica toolbar:** The brief only mentioned a label, but the implementation includes the search input (`.char-bench-search`). This is reasonable — it matches the normal bench UX and costs nothing. Flag it if stricter fidelity to "só um rótulo" is required; otherwise, it's a UX win.

2. **Copper accent for Metamágica:** The brief said "só um realce... se precisar". The implementation adds a subtle copper color to distinguish it from normal spheres. This is minimal and clear; good judgment.

3. **Future-proofing (`[0]` in `metamagicAllowance`):** The code correctly notes that if a second restricted-allowance feature is added, this should become a feature-keyed lookup. Scope is 1 today; the seam is identified.

---

## Verdict: **SHIP**

**Blockers:** None.  
**Should-fix:** None.  
**Nits:** None.

The implementation is correct, complete, and matches the brief exactly. All tests pass. No regressions detected. The decision to keep `.char-mm-add` off the `.char-btn` class is well-justified and prevents a crash. The rules layer correctly excludes Metamágica from the general budget and surfaces it as a restricted allowance. The UI cleanly reuses accordion machinery and delegates properly to the rules layer.

**Out-of-scope cleanup:** The removal of `.char-rail-addsphere` CSS is harmless and improves code hygiene, but should be noted in the commit message as a separate housekeeping item.

---

**Ready to merge.** No owner sign-off required on regressions or bugs — all clean.
