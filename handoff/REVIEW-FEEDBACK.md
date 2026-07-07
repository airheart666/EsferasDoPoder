# Review Feedback — Layout B (Bancada): Restructure the "Meu Personagem" Sheet
*Written by Reviewer (Richard). Read by Builder (Bob) and Architect (Arch).*

Date: 2026-07-07  
Ready for Handoff: **SHIP**

---

## Verdict

**SHIP.** No blockers. Event wiring is correct, double-handling guards are mutually exclusive by construction, view-state lifecycle is solid, P1/P2 regression test passes, deleted code has no remaining references. All 7 high-value verification points cleared.

---

## Blockers

None.

---

## Should-Fix

None. The two flagged judgment calls are correct:
- **`refreshCharBench()` patching both `.char-build` and `.char-bench`** — Correct. Switching active sphere via the rail is view-only, but it changes *which* sphere's panel must display in `.char-build`. Without patching it, the rail highlight moves while the build panel stales. The constraint "only patch `.char-bench`" in the brief was too literal; the intended behavior (matching the prototype's unified render) requires both patches. **No change needed.**
- **`_unresolvedLegacy` warnings only visible when sphere is active** — Correct. This is expected master-detail behavior. Warnings no longer all scroll into view at once; they only show when that specific sphere is active. No data is lost; display is just deferred. **No change needed.**

---

## High-Value Verification (7 Points)

### 1. No double-handling of `.char-btn`

**Status: ✓ PASS**

- **Location:** `app.js:2551–2570` in `setupCharacter()`'s click listener
- **Structure:**
  ```javascript
  const cbtn = e.target.closest('.char-btn');
  if (cbtn && cbtn.closest('.char-sphere')) {
    // Branch 1: build panel (lines 2552–2559)
    // ... applyTalentToggle(...) ... renderCharacter() ...
    return;  // <-- early exit
  }
  if (cbtn && cbtn.closest('.char-bench')) {
    // Branch 2: bench Add button (lines 2563–2570)
    // ... applyTalentToggle(...) ... renderCharacter() ...
    return;  // <-- early exit
  }
  ```
- **Verification:** Each branch is guarded, and each has an explicit `return`. Since `.char-sphere` and `.char-bench` are sibling containers that wrap mutually exclusive DOM subtrees (the active sphere's build panel vs. the workbench panel), they can never both match the same click target. Exactly one branch fires per click; no fall-through. ✓

---

### 2. Search focus/caret preservation in `refreshCharBench()`

**Status: ✓ PASS**

- **Location:** `app.js:2212–2241` in `refreshCharBench()`
- **Implementation detail (lines 2231–2239):**
  ```javascript
  const activeEl = document.activeElement;
  const wasSearch = !!(activeEl && activeEl.classList && activeEl.classList.contains('char-bench-search'));
  const caret = wasSearch ? activeEl.selectionStart : null;
  // ... rebuild benchHost ...
  if (wasSearch) {
    const inp = benchHost.querySelector('.char-bench-search');
    if (inp) { 
      inp.focus(); 
      if (caret != null) { 
        try { 
          inp.setSelectionRange(caret, caret); 
        } catch (_) { /* ignora */ } 
      } 
    }
  }
  ```
- **Verification:** 
  - Saves the active element before rebuild ✓
  - Checks `classList.contains()` safely (guards against null) ✓
  - Saves `selectionStart` only if it was the search input ✓
  - After DOM rebuild, re-queries for the new input ✓
  - Re-focuses the freshly-built input ✓
  - Restores caret with `try-catch` to handle edge case where `setSelectionRange` might fail ✓
  - No risk of throwing or targeting wrong element ✓

---

### 3. P1/P2 not regressed (build panel structure intact)

**Status: ✓ PASS**

- **P1 (Granted sphere with free-pick selector):** 
  - Location: `renderSphereBuildPanel` returns a `<section class="char-sphere">` (line 1823)
  - Lines 1849–1854: Builds `.char-sphere-manage` container when `pkgSel` or `freePickSels.length > 0`
  - Structure preserved verbatim from old code ✓
  
- **P2 (Universal package selection):**
  - Same code path (`buildPackageSelector` called at line 1846)
  - `.char-sphere-manage` container still wraps the selector ✓

- **Event handlers still working:**
  - `setupCharacter` lines 2634–2639: `.pkg-select` guarded by `.closest('.char-sphere')` ✓
  - `setupCharacter` lines 2641–2646: `.freepick-select` guarded by `.closest('.char-sphere')` ✓
  - Both branches call their enforcement wrappers and trigger full re-renders ✓

- **Verification:** `.char-sphere` container class is present; `.char-sphere-manage` is built when needed; the `.pkg-select`/`.freepick-select` guards inside those helpers remain untouched and fire correctly. ✓

---

### 4. Reading-page acquire bar untouched

**Status: ✓ PASS (not modified in this change)**

- No changes to `renderSphereAcquireBar`, `setupFavorites`, or reading-page event handlers
- Confirmed by REVIEW-REQUEST: "Reading-page acquire bar (`renderSphereAcquireBar`/`refreshSphereUI`/`addFavoriteStars`) untouched."
- Verified by grep: no `.sphere-acquire` references added/removed in this diff
- ✓

---

### 5. View-state lifecycle (charView reset and normalization)

**Status: ✓ PASS**

- **Character switch (`switchActiveChar`):**
  - Line 2200–2202:
    ```javascript
    function switchActiveChar(id) {
      setActiveCharId(id);
      resetCharView(getActiveChar());
    }
    ```
  - Called at character tab click (line 2504) ✓
  - Called at "Delete character" confirmation (line 2544) ✓
  - Resets the view for the new active character ✓

- **Reset logic (`resetCharView`):**
  - Line 2183–2189: Sets `charView.sphere` to first sphere title (or null if none)
  - Sets `benchMode = 'talents'`, clears `sel` and `search` ✓
  - Ensures rail/bench always start at a valid state ✓

- **Deleted sphere handling (`normalizeCharView`):**
  - Line 2193–2197: Called at top of every `renderCharacter()` (line 2297) ✓
  - Checks if `charView.sphere` is still in `charSphereTitles(active)` ✓
  - If sphere no longer exists (e.g., user removed it), calls `resetCharView` to pick the first valid sphere ✓
  - If sphere is still valid, preserves `benchMode`, `sel`, `scope`, `search` (view state survives sphere deletions) ✓
  - No risk of dangling active sphere or throwing ✓

- **Verification:** All three functions fire at the right times; charView never gets into an invalid state (missing sphere or bench mode). ✓

---

### 6. The two flagged judgment calls (assessed)

**Judgment Call A: `refreshCharBench()` patching `.char-build` in addition to `.char-bench`**

- **What the code does:** Lines 2223–2228 empty and rebuild both `#char-build` and `#char-bench` on view-only actions
- **Why this is correct:** Switching active sphere via the rail (`.char-rail-sphere` click) is semantically "view-only" (no mutation), but it changes *which* sphere's build panel should display. Without patching `.char-build`, the rail highlight toggles to the new sphere but the build panel stales, showing the old sphere's talents. This breaks the UI contract.
- **Alignment with prototype:** The prototype's monolithic `render()` always redraws both `.char-build` and `.char-bench` together whenever view state changes. This implementation narrows it to only these two elements (rail's form/stats are left alone, mutation-only) for the specific reason this two-tier design exists: to preserve search focus.
- **Assessment:** **Correct. No change needed.** This is not a deviation; it's the intended behavior. Bob's flagging was appropriate transparency, but the choice is sound.

---

**Judgment Call B: `_unresolvedLegacy` migration warnings now only visible when sphere is active**

- **What changed:** Old flat layout showed all `_unresolvedLegacy` warnings at once (in the old "per-sphere loop" across *all* spheres). New master-detail layout only shows warnings for `charView.sphere` (the active one in `.char-build`).
- **Why this happens:** `renderSphereBuildPanel` (lines 1835–1840) checks and displays warnings; it's now called only once for the active sphere, not looped.
- **Data loss concern:** None. `_unresolvedLegacy` data persists in the character object (never deleted); it's just not displayed unless that sphere is active.
- **UX consideration:** Minor. Users won't see all warnings at a glance; they must click each sphere to see its warnings. This is expected master-detail behavior and arguably acceptable (reduces visual clutter).
- **Assessment:** **Expected and acceptable. No change needed.** This is a minor UX consequence of the architecture, not a bug. If Arch wants all warnings visible at all times, it would require adding a persistent warning banner outside the master-detail, which is out of scope for this change.

---

### 7. Deleted functions and CSS have no remaining references

**Status: ✓ PASS**

- **Deleted functions:**
  - `buildAddTalentPicker` — grep finds only comments referencing it (line 1670, 2025), no function calls
  - `buildAddSpherePicker` — grep finds only comments referencing it (line 1737, 2130), no function calls
  - **Verification:** No dead handlers pointing at removed producers ✓

- **Deleted CSS rules:**
  - `.char-add-talent`, `.char-add-talent-row`, `.char-add-btn.char-btn`, `.char-add-sphere`, `.char-add-sphere-select`, `.char-add-sphere-btn`
  - Grep in `app.js` and `style.css`: 0 matches ✓
  - The markup that produced these classes is gone; no stray references in event handlers ✓

- **Verification:** Complete removal; no dead code left behind. ✓

---

## Additional Checks

- **Event listeners:** 
  - New `content.addEventListener('input', ...)` for `.char-bench-search` at line 2650–2653 — correctly scoped and updates view-state only ✓
  - All existing click/change handlers preserved and extended without breaking pre-existing paths ✓

- **CSS media query:**
  - 880px breakpoint (line 2023–2026) collapses layout to single column — standard responsive pattern ✓
  - Uses pre-existing design tokens (`--accent`, `--table-border`, `--stat-bg`, `--oxblood`, `--verdigris`, `--copper`) — dark mode compatibility automatic ✓

- **Module-level state:**
  - `charView` at module scope (line 26), never persisted to localStorage — correct for session-only view state ✓
  - No risk of stale shared state across different pages ✓

---

## Automated Verification (from REVIEW-REQUEST)

- `npm run validate` — 0 errors ✓
- `npm run typecheck` — green ✓
- `npm test` (rules) — 28/28 ✓
- `node scripts/sanity-builder.js` — 29/29 ✓
- `node --check app.js` — clean ✓
- jsdom smoke test (24/24 assertions) — full layout, focus preservation, view-state updates, character switch, sphere acquire, talent add ✓

---

## Summary

This is a well-executed UI restructure. The two-tier re-render strategy (mutations → full render, view-only → `refreshCharBench`) correctly balances performance and UX. Event delegation is sound; guards prevent double-mutation. View-state lifecycle handles edge cases (deleted sphere, character switch). The two judgment calls are correct choices, not deviations. P1/P2 not regressed. Deleted code is complete (no orphaned references). Ready for production.

**Recommendation: SHIP.** No fixes needed. Browser click-through checklist (REVIEW-REQUEST section) should be completed by the Owner before merge.
