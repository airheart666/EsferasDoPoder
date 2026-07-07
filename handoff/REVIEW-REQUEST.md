# Review Request — P3: full in-sheet character builder
*Written by Builder (Bob). Read by Reviewer (Richard).*

Ready for Review: YES

---

## What Was Built

The "Meu Personagem" sheet (`renderCharacter`) is now a complete builder: acquire a
sphere, choose a package, pick free talents, and add/remove extra talents — all without
leaving the sheet. The reading-page acquire bar (`renderSphereAcquireBar`) keeps working
identically; its selector-building logic was extracted into small helpers shared by both
places instead of duplicated. No rule logic changed — every mutation still goes through
the existing enforced wrappers (`tryAcquireSphere`, `setPackage`, `setFreePickAt` (via a
new shared `applyFreePickSelection`), `addFreePickChecked`/`addExtraTalentChecked` (via
`applyTalentToggle`, reused verbatim), `toggleExtraTalent`, `removeSphere`). `src/rules.js`
was not touched.

## Files Changed

| File | Lines | Change |
|---|---|---|
| `app.js` | 696-716 (new) | `buildPackageSelector(active, title, spec)` — extracted from `renderSphereAcquireBar`'s inline package-select block; returns the `<label class="pkg-l">` or `null`. Used by both the reading-page bar and the sheet. |
| `app.js` | 717-750 (new) | `buildFreePickSelectors(active, title, spec, model, entry)` — extracted from the inline free-pick-select loop; returns an array of `<label class="freepick-l">` (was appending directly to the bar). Used by both places. |
| `app.js` | 751-762 (new) | `applyFreePickSelection(active, title, index, talentId, anchorEl)` — extracted the "check `Rules.prereqCheck`, then `setFreePickAt`" logic that used to be inlined in `setupFavorites`'s change handler; returns `true` only if it mutated, so each caller decides how to re-render. |
| `app.js` | 764-~880 (`renderSphereAcquireBar`) | Now calls the three helpers above instead of the inline blocks. DOM output is unchanged for the reading page (verified — see Verification). |
| `app.js` | `setupFavorites`'s click handler (`.char-btn` case) | Added `if (cbtn && cbtn.closest('.char-sphere')) return;` guard so the sheet's own talent buttons don't trigger the multi-character "Adicionar a…" popover (which only makes sense on reading pages, where the target character is ambiguous). |
| `app.js` | `setupFavorites`'s change handler (`.pkg-select`/`.freepick-select`) | Added the same `.closest('.char-sphere')` guard to each, and the free-pick branch now calls the shared `applyFreePickSelection` instead of inlining the prereq check. |
| `app.js` | 1657-1683 (new) | `buildAddTalentPicker(active, title, model, entry, granted)` — the sheet's "adicionar talento" control: filters `model.freeGroup.concat(model.extras)` down to ids not already owned and not subclass-fixed (`isGrantedTalentId`), renders one `makeCharControl` button per candidate (same +/state logic as the compendium's card buttons — reused, not reimplemented). |
| `app.js` | 1687-1725 (new) | `buildAddSpherePicker(active)` — the sheet's "adicionar esfera" control: a `<select>` with `<optgroup>`s (Esferas de Magia / Esferas de Poder) listing every sphere not already owned or granted, plus a button. |
| `app.js` | `renderCharacter` (per-sphere loop) | For each sphere group: computes `spec = resolveSpec(...)` and inserts a `.char-sphere-manage` block (package selector + free-pick selectors) before the talent-card boxes, and the add-talent picker after the extras box. Also inserts `buildAddSpherePicker` near the top of the "Esferas e talentos" section (after the `h2`, before the granted-talent-replacement note). |
| `app.js` | `setupCharacter`'s click handler | Added three cases: `.char-add-sphere-btn` (reads the sibling select, calls `tryAcquireSphere`, `showCharNotice` on failure else `renderCharacter()`); `.char-btn` inside `.char-sphere` (calls `applyTalentToggle` directly on `getActiveChar()` — no popover — then `renderCharacter()` if it mutated). |
| `app.js` | `setupCharacter`'s change handler | Added `.pkg-select`/`.freepick-select` cases scoped to `.char-sphere` (mirrors the reading-page handlers but calls `renderCharacter()` instead of `refreshSphereUI`, since the sheet needs a full re-render — budget panel, card lists, and remaining option lists all depend on the new state). |
| `style.css` | after `.char-card-tag.char-tag-free` (~1744) | New rules for `.char-sphere-manage`, `.char-add-talent`/`.char-add-talent-row`/`.char-add-btn`, `.char-add-sphere`/`.char-add-sphere-select`/`.char-add-sphere-btn`. All the *inner* controls (`.pkg-select`, `.freepick-select`, `.char-btn`) reuse their existing global styles unchanged. |

## The Shared-Helper Refactor (why it's safe)

`setupFavorites()` and `setupCharacter()` both attach delegated click/change listeners to
the same `#content` element at init time, and both fire for every event bubbling through
it regardless of which view currently occupies `#content` (reader chapter, favorites, or
the character sheet). Reusing the exact same control classes (`.pkg-select`,
`.freepick-select`, `.char-btn`) in the sheet therefore risked **double-handling**: both
listeners would see the same event. Rather than invent new class names (which would have
meant duplicating the selector-building code), the fix is ancestry-based disambiguation:
`.char-sphere` only ever exists inside the sheet, `.sphere-acquire` only ever exists on
reading pages, so each `setupFavorites` handler now bails with one guard line
(`if (X.closest('.char-sphere')) return;`) and lets `setupCharacter`'s own handler own
that case (mutate, then `renderCharacter()` for a full re-render instead of the reading
page's targeted `refreshSphereUI` DOM patch). No new dataset markers needed, no
dual-mutation risk, and the reading page's behavior is byte-for-byte unchanged (same
helper functions, same classes, same handler logic minus the extraction).

## Event-Wiring Approach

- **Reading page** (unchanged behavior): `setupFavorites` still owns `.acquire-btn`,
  `.sphere-remove`, `.char-target-select`, and (outside `.char-sphere`) `.pkg-select`,
  `.freepick-select`, `.char-btn`. Re-render via targeted `refreshSphereUI(title)`.
- **Sheet**: `setupCharacter` owns everything inside `.char-sphere` — the package
  selector, free-pick selectors, the new add-talent buttons — plus the new
  `.char-add-sphere-btn`/`.char-add-sphere-select` pair (which sits outside any
  `.char-sphere`, at the top of the section, so no guard was needed there — it's a
  sheet-only class to begin with). Re-render strategy is always a full
  `renderCharacter()` (the sheet already re-renders fully on every other mutation —
  `.char-talent-remove`, `.char-sphere-remove`, `.char-field` all already worked this
  way); the active character persists via `getActiveCharId()`/localStorage, not
  component state, so nothing needs to be manually preserved across the re-render.

## How This Was Verified

- `npm run validate` — 0 errors (unaffected; doesn't touch app.js).
- `npm run typecheck` — green (unaffected; app.js not in scope, confirmed in tsconfig.json).
- `npm test` (`scripts/test-rules.js`) — 28/28, unaffected (pure `src/rules.js`, untouched).
- `node scripts/sanity-builder.js` — 29/29, unaffected (doesn't boot DOM listeners, so it
  doesn't exercise the new UI code, but confirms nothing about the rules engine / data
  wiring regressed).
- **New, ad hoc (not committed as a script — Node + jsdom, same technique as
  sanity-builder.js, run interactively during the build):** loaded the real
  `parser.js`/`chapters.js`/`src/rules.js`/`src/data.js`/`app.js` into a jsdom context,
  called the real `setupFavorites()`/`setupCharacter()`/`renderCharacter()`, and drove
  actual DOM events end-to-end:
  - Sheet: acquired "Universal" (has packages), changed the sheet's `.pkg-select` to
    "dissipar" via a dispatched `change` event → confirmed `entry.choices.pkg` updated
    via the mutator (not a stale re-render).
  - Sheet: switched to the "mana" package (has a free pick) → confirmed
    `.char-sphere-manage .freepick-select` appeared with the right options, picked one
    via `change` → confirmed `entry.freePicks` updated correctly.
  - Sheet: add-talent picker → confirmed it lists not-yet-owned talents, clicking one
    routes through `applyTalentToggle` and lands in `entry.talents` (extra, cost 1) as
    expected for that package.
  - Sheet: add-sphere picker → confirmed the `<optgroup>`s exclude already-owned/granted
    spheres, and clicking "+ Adquirir esfera" with a selection acquires it via
    `tryAcquireSphere`.
  - **P1 regression check**: created a Feiticeiro with subclass "Sangue Feérico"
    (grants Mente for free) → confirmed the sheet's Mente group renders a
    `.freepick-select` even though the sphere was never explicitly "acquired".
  - **Blocked-pick check**: exhausted a level-1 Feiticeiro's magic-slot budget by
    acquiring spheres up to the cap, then tried the sheet's add-sphere picker for one
    more → confirmed `tryAcquireSphere` returned `ok:false` and a `.char-warn-toast`
    notice appeared with the expected message, with no state mutation.
  - **Reading-page regression check**: rendered `renderSphereAcquireBar` for "Universal"
    standalone (as the reader would), dispatched a `.pkg-select` change → confirmed the
    mutation applies via `setupFavorites`'s (not `setupCharacter`'s) handler; confirmed
    `.char-target-select` still renders when ≥2 characters exist.

All of the above exercises the *real* functions from the *real* app.js (not
reimplemented), so it's a meaningful check of the wiring — but it is not a substitute for
a human clicking through an actual rendered page (styling, focus behavior, scroll
position, and anything relying on real browser layout/CSS were not verified this way).

## Browser Click-Through Checklist (for Richard/Owner)

1. Open the app, go to **Meu Personagem**, create a character (pick class/level).
2. Near the top of "Esferas e talentos", use the **"adicionar esfera"** select + button
   to acquire a sphere. Confirm it appears below with the right talent count, and the
   budget panel at the top updates.
3. Acquire **Universal** (or another sphere with packages) from the sheet's add-sphere
   picker; confirm a **package selector** appears inside that sphere's group; pick a
   package (e.g. the Universal one that grants a free pick) and confirm the base ability
   updates and a **free-pick selector** appears.
4. Use the free-pick selector to choose a talent; confirm it shows up under "Incluído com
   a esfera" and doesn't cost a slot (budget panel unchanged).
5. Use the **"adicionar talento"** row of pill buttons to add an extra talent; confirm it
   appears under "Talentos" with a ✕ remove button, and the magic/martial budget count
   increases by 1.
6. Click that ✕ to remove it; confirm it disappears and the budget count decreases.
7. Try to trigger a **blocked pick**: either exhaust the talent budget (add talents until
   full) and try one more, or try to add a talent whose prerequisite isn't met. Confirm a
   notice appears near the control and the pick does NOT apply.
8. Pick a class/subclass that **grants a sphere for free** (e.g. Feiticeiro → subclasse
   Sangue Feérico grants Mente). Confirm that sphere shows up in the sheet tagged
   "concedida", with its own free-pick selector, and that it can't be removed (no
   "Remover esfera" button).
9. **Confirm the reading-page acquire bar still works**: open any sphere chapter that has
   ≥1 saved character, and repeat the acquire/package/free-pick/remove flow from there —
   should look and behave exactly as before this change.
10. With 2+ characters, click the **+** on a talent card in a sphere *chapter* (not the
    sheet) — the "Adicionar a…" character-choice popover should still appear (this path
    is untouched); confirm the sheet's own add-talent buttons do NOT show this popover
    (they should act immediately on the sheet's own character).

## Deviations From the Brief

None of substance. One elaboration: the brief's example helper signature was
`buildFreePickSelectors(active,title,spec,model)`; I added `entry` as a 5th parameter
since the existing free-pick logic needs `entry.freePicks` to know which slots are
already filled — this matches how `renderSphereAcquireBar` already used `entry` before
extraction, just threaded through explicitly instead of via closure.

## Open Questions

None outstanding. If the Owner wants the add-talent picker's option labels to preview
"grátis" vs "custa 1 talento" more precisely (right now `makeCharControl` derives that
from live state at render time, same as the compendium — it doesn't pre-compute a static
label), that would be a small follow-up, not a blocker.
