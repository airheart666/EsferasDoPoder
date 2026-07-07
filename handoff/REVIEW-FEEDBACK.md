# Review Feedback — P3: Full In-Sheet Character Builder
*Written by Reviewer (Richard). Read by Builder and Architect.*

Date: 2026-07-06  
Ready for Builder: **FIX-THEN-SHIP** (1 should-fix)

---

## Verdict

**FIX-THEN-SHIP.** Event wiring is sound, double-handling guards correct, enforcement routing solid, no blockers. One should-fix: inconsistent re-render logic in `.freepick-select` handler (wasteful, violates established pattern). All automated checks pass.

---

## Must Fix

None.

---

## Should Fix

**1. Inconsistent re-render logic in `.freepick-select` handler**
- **File:Line** — `app.js:2225–2230`
- **What's wrong** — The `.freepick-select` change handler (in `setupCharacter`) always calls `renderCharacter()` regardless of whether the mutation succeeded AND even if `active` is null. This is inconsistent with:
  - The `.pkg-select` handler (line 2218–2222), which only re-renders if `active` is truthy
  - The `.char-btn` handler (line 2199), which only re-renders if `applyTalentToggle` returns true (mutation succeeded)
  - The reading-page pattern (setupFavorites line 1054), which checks the return value of `applyFreePickSelection` before calling `refreshSphereUI`
  
  Impact: (a) Wasteful re-renders when `active` is null (unlikely in practice, but inconsistent). (b) Wasteful re-renders when mutation is blocked (unmet prereq) — state doesn't change, but sheet re-renders anyway. While not incorrect (unchanged state re-renders identically), it violates the established early-return pattern and wastes CPU.

- **Fix** — Change line 2227–2228 from:
  ```javascript
  if (active) applyFreePickSelection(active, sel.dataset.sphere, parseInt(sel.dataset.i || '0', 10), sel.value || null, sel);
  renderCharacter();
  ```
  to:
  ```javascript
  if (active && applyFreePickSelection(active, sel.dataset.sphere, parseInt(sel.dataset.i || '0', 10), sel.value || null, sel)) {
    renderCharacter();
  }
  ```

---

## Escalate to Architect

None.

---

## DoD Verification

- **Shared-helper refactor** ✓ — `buildPackageSelector`, `buildFreePickSelectors`, `applyFreePickSelection` extracted correctly and used identically by reading page and sheet; DOM output byte-for-byte equivalent; old inline code branches match new helper output.
- **Double-handling guards** ✓ — All guards in place:
  - setupFavorites: line 1015 (`.char-btn`), line 1042 (`.pkg-select`), line 1050 (`.freepick-select`) — all bail with `if (X.closest('.char-sphere')) return;`
  - setupCharacter: lines 2194, 2218, 2225 check `if (X.closest('.char-sphere'))` to own only sheet controls
  - No dead controls (all have handlers); no double-mutation paths (guards prevent setupFavorites from running when setupCharacter owns the event).
- **Enforcement routing** ✓ — All mutations via enforced wrappers:
  - `.char-add-sphere-btn` → `tryAcquireSphere` (line 2186, gates on budget)
  - `.char-btn` inside `.char-sphere` → `applyTalentToggle` (line 2199, checks entry/grant/prereq)
  - `.pkg-select` inside `.char-sphere` → `setPackage` (line 2220)
  - `.freepick-select` inside `.char-sphere` → `applyFreePickSelection` (line 2227, checks prereq)
  - Blocked picks show `showCharNotice` and don't mutate (returns false, confirmed by testing).
- **P1 regression** ✓ — Granted spheres render free-pick selectors correctly in sheet (uses same `buildFreePickSelectors`, `resolveSpec`, and `model.freePicks` calculation as reading page).
- **P2 regression** ✓ — Universal package selector works in sheet (uses same `buildPackageSelector` and spec resolution; tested via sanity-builder "Universal 'mana' model").
- **Reading-page stability** ✓ — `renderSphereAcquireBar` now calls the three helpers instead of inlining; setupFavorites handlers unchanged except for guard lines; behavior identical.
- **src/rules.js** ✓ — Untouched; no rules changes.
- **Automated checks** ✓ — All pass:
  - `npm run validate`: 0 errors
  - `npm run typecheck`: green
  - `npm test`: 28/28
  - `node scripts/sanity-builder.js`: 29/29 (covers rules, prereqs, grants, budget enforcement, Universal packages)
- **CSS** ✓ — `.char-sphere-manage`, `.char-add-talent`, `.char-add-sphere` styles added; inner controls (`.pkg-select`, `.freepick-select`, `.char-btn`) reuse existing global styles unchanged.

---

## Testing Limitations (noted)

Sanity-builder and test-rules.js do NOT exercise DOM event listeners, so they confirm "rules/data wiring correct" but not "UI event handlers fire correctly." That requires manual browser test (see REVIEW-REQUEST checklist). No automated gate covers:
- Click handlers wiring (`setupCharacter` click listener firing for `.char-add-sphere-btn`, `.char-btn` inside `.char-sphere`)
- Change handlers wiring (`setupCharacter` change listener for `.pkg-select`/`.freepick-select` inside `.char-sphere`)
- Popover suppression (sheet's `.char-btn` doesn't show "Adicionar a…" character picker)

---

## Cleared

Event delegation sound (guards prevent double-mutation; all controls have handlers). Enforcement layer intact (all mutations routed through enforced wrappers; blocked picks show notices, don't persist). Reading-page behavior preserved (shared helpers, identical DOM output). P1/P2 not regressed. Brief adherence complete. One minor should-fix (re-render consistency). Ready for Owner's manual browser test once fixed.
