# Review Request — Layout B (Bancada): restructure the "Meu Personagem" sheet
*Written by Builder (Bob). Read by Reviewer (Richard).*

Ready for Review: YES

---

## What Was Built

`renderCharacter` (the "Meu Personagem" sheet) is restructured into **Layout B / Bancada**,
matching the approved interactive prototype at `design-previews/builder-bancada.html`
(behavior/visual contract). This is UI plumbing only — it reuses the P3 enforcement layer
end-to-end; **no rule changed, `src/rules.js` untouched**.

New shape: a sticky left **rail** (character tabs, identity form, collapsible
proficiências, mini-stats + a new budget bar, and a sphere-navigation list) and a right
**main** area with the **active sphere's build panel** on top and a **master-detail
workbench (the "bancada")** underneath — always visible, no modal/overlay. Adding a
sphere happens in the same workbench (a "esferas" mode), not a separate picker.

Every mutation (add/remove talent, acquire/remove sphere, package, free pick, `.char-field`)
still goes through the exact same wrappers as before (`applyTalentToggle`, `tryAcquireSphere`,
`setPackage`, `applyFreePickSelection`, `toggleExtraTalent`, `removeSphere`) and still
triggers a full `renderCharacter()`. The only new thing is a **second, lighter re-render
path** — `refreshCharBench()` — for purely visual state (which item is selected, search
text, scope, which sphere is active in the rail) that doesn't touch the rules engine at all.

## Files Changed

| File | What | Why |
|---|---|---|
| `app.js` | New module-level `charView = { sphere, benchMode, sel, scope, search }` (top of file, near the other module-level `let`s) | View-only state for the bancada — never written to localStorage, survives re-renders, reset on character switch. |
| `app.js` | New: `charSphereTitles`, `talentCandidatesForSphere`, `talentPickPath`, `talentGate` (+`prereqStatusLabel`/`describePrereqs`), `sphereCandidates` | Pure-data versions of the filtering logic that used to live inside `buildAddTalentPicker`/`buildAddSpherePicker` (same predicates, same order) — extracted so the bench can build a list+detail from data instead of a `<select>`/pill row. `talentGate` reads `Rules.prereqCheck`/`Rules.canAddTalent` **display-only**, mirroring `applyTalentToggle`'s own branching exactly. |
| `app.js` | **Deleted**: `buildAddTalentPicker`, `buildAddSpherePicker` | Their DOM output (inline pill row / `<select>`+button) has no place in Layout B — the bench replaces both. Kept-but-unused would be dead code; the filtering logic itself was preserved (see above), not reimplemented. |
| `app.js` | `charTalentCard` hoisted to module scope (was a closure inside the old `renderCharacter`) | Body unchanged; now reusable by `renderSphereBuildPanel` without re-declaring a closure on every render. |
| `app.js` | New `renderSphereBuildPanel(active, title)` | Extracted verbatim from the old per-sphere loop body — same DOM (header, `.char-sphere-manage`, "Incluído com a esfera", "Talentos", "Remover esfera"), still returns an element with the `.char-sphere` class. Now called once (active sphere only) instead of looped over every sphere. |
| `app.js` | New: `buildCharBuildContent`, `buildRailNavHTML`, `buildCharBudgetHTML`/`statCellHTML`/`budgetBarHTML`, `buildTalentDetail`, `buildTalentBenchPanel`, `buildSphereDetail`, `buildSphereBenchPanel`, `buildCharBenchInner` | The rail nav, the budget mini-grid+bar (same `Rules.slotsSpent`/`traditionBonus`/`classFeatureBonus` numbers as before, re-presented as a bar instead of a text cell), and the two bancada modes (talents / spheres), each as list+detail. |
| `app.js` | New: `resetCharView`, `normalizeCharView`, `switchActiveChar`, `refreshCharBench` | View-state lifecycle + the second re-render tier (see below). |
| `app.js` | `renderCharacter()` rewritten | Same early-returns (no dataIndex, no active character) preserved verbatim. For an active character: builds `.char-layout` (`.char-rail` + `.char-main`), calls `normalizeCharView`, and assembles rail/build/bench from the new builders above. |
| `app.js` | `setupCharacter()` — extended, not replaced | `.charsel-tab`/`#char-new`/`#char-delete` now call `switchActiveChar`/`resetCharView` (resets the bancada view on character switch, matching the prototype's `selectChar`). Removed the now-unreachable `.char-add-sphere-btn` case (its producer is gone). Added, inside the **same** existing delegated click listener: `.char-rail-sphere` (switch active sphere — view-only), `.char-rail-addsphere` (enter spheres mode — view-only), `.char-bench-li` (select — view-only), `.char-bench-scope[data-scope]` (toggle scope — view-only), `.char-bench-acquire` (acquire the selected sphere — **mutation**), and a second `.char-btn` branch guarded by `.closest('.char-bench')` (add a talent from the bench detail — **mutation**, reuses `applyTalentToggle`). Added one new listener kind, `content.addEventListener('input', ...)`, scoped to `.char-bench-search` only (live filtering; `change` doesn't fire per keystroke). |
| `style.css` | Deleted dead rules: `.char-add-talent(-row)`, `.char-add-btn.char-btn`, `.char-add-sphere(-select\|-btn)` | Markup that produced them no longer exists. |
| `style.css` | New Layout B block (`.char-layout`, `.char-main`, rail sizing overrides for the *reused* `.char-stats`/`.char-stat`, `.char-profs-details`, `.char-budget-bar` family, `.char-railnav`/`.char-rail-sphere`/`.char-rail-addsphere`, `.char-build .char-sphere` panel chrome, full `.char-bench*` family) + an 880px collapse-to-1-column media query | Visual layer only. Reuses existing design tokens (`--accent`, `--table-border`, `--stat-bg/-border`, `--oxblood`, `--verdigris`, `--copper`, fonts) so dark mode works automatically — no separate palette like the standalone mockup file needed. |

## The Two-Tier Re-render Strategy

- **Mutations** (add/remove talent, acquire/remove sphere, package, free pick, `.char-field`)
  → `renderCharacter()`, unchanged as the standing pattern. Rebuilds the whole sheet
  including the rail (budget/stats can change on any of these).
- **View-only** (select a bench item, toggle scope, type in search, switch the active
  sphere via the rail, enter/leave "spheres" mode) → **`refreshCharBench()`**. This:
  1. Toggles the `.active` class on `.char-rail-sphere`/`.char-rail-addsphere` in place
     (no rebuild of the rail's form/proficiências/stats — those never depend on view state).
  2. Replaces `#char-build`'s content.
  3. Replaces `#char-bench`'s content, and if a `.char-bench-search` input had focus before
     the patch, re-focuses the new one and restores the caret position (`selectionStart`)
     so typing doesn't stutter.

  **Note on scope, flagged for review:** the brief's literal wording says
  `refreshCharBench()` "substitui só o subtree `.char-bench`". I deliberately also patch
  `.char-build` (step 2) — switching the active sphere via the rail is a view-only action,
  but it changes *which sphere's panel* `.char-build` must show. Without patching it too,
  the rail highlight would move while the build panel kept showing the old sphere. The
  rail's own stats/form are still left alone (mutation-only). I believe this is what was
  intended (the mockup's monolithic `render()` always redraws both together), just
  narrowed here for the search-focus problem specifically — flagging in case Arch reads it
  differently.

## Event-Wiring Approach

Both the rail and the bench are inside `#content`, so everything routes through the
**existing** delegated `click`/`change` listeners already bound in `setupCharacter` — no
new listener objects except one `input` listener (needed because `change` only fires on
blur, not per keystroke, and the brief lists `.char-bench-search` as a required new wire).
Guards used to keep the two `.char-btn` producers apart:
- `.char-btn` inside `.char-sphere` (the build panel's "Incluído"/"Talentos" cards) → the
  pre-existing branch, unchanged.
- `.char-btn` inside `.char-bench` (the workbench's Add button, produced by
  `makeCharControl` same as everywhere else) → new branch, same `applyTalentToggle` call.

These two containers are siblings and mutually exclusive by construction, so there's no
double-handling risk (same pattern P3 already established for `.char-sphere` vs.
`.sphere-acquire` on the reading page — untouched here).

## Not Regressed (verified, see below)

- **P1** (a granted sphere, e.g. Mente from Sangue Feérico, offers a free-pick selector in
  the sheet without ever being "acquired") — `renderSphereBuildPanel` still builds
  `.char-sphere-manage` from `buildPackageSelector`/`buildFreePickSelectors` exactly as
  before, and `.char-sphere` + `.closest('.char-sphere')` guards are all still in place.
- **P2** (Universal package selection in the sheet) — same code path, untouched.
- **Reading-page acquire bar** (`renderSphereAcquireBar`) — not modified at all; confirmed
  it still returns `.sphere-acquire` markup and is unaffected by anything in this change
  (it's built by `setupFavorites`, a completely separate function).

## How This Was Verified

- `npm run validate` — 0 errors (unaffected, doesn't touch app.js).
- `npm run typecheck` — green (app.js is out of `checkJs` scope, confirmed in tsconfig.json).
- `npm test` (`scripts/test-rules.js`) — 28/28, unaffected (pure `src/rules.js`, untouched).
- `node scripts/sanity-builder.js` — 29/29, unaffected (rules/migration layer only).
- `node --check app.js` — clean.
- **New jsdom smoke test** (written during the build, same technique as
  `scripts/sanity-builder.js` — loads the real `parser.js`/`chapters.js`/`src/rules.js`/
  `src/data.js`/`app.js` into a jsdom `vm` context, not committed as a script but the code
  is reproducible from this description): called the real `setupCharacter()` +
  `renderCharacter()`, created a level-5 **Feiticeiro (Sangue Feérico)**, and dispatched
  real `click`/`input` DOM events:
  - Empty state (no character) renders its message, no throw.
  - Full layout present: `.char-layout`, `.char-rail`, `.char-main`, `.char-build`,
    `.char-bench`, `.char-railnav` populated (Mente granted → at least one rail entry),
    `.char-build .char-sphere` present, `.char-budget-bar` rendered, bench list populated
    with Mente candidates.
  - Clicking a `.char-bench-li` updates `charView.sel` and the detail panel shows that
    talent's `<h4>`.
  - Clicking the "Todas" scope chip updates `charView.scope`.
  - Typing in `.char-bench-search` (dispatched `input`) updates `charView.search` **and**
    the input keeps focus after the `refreshCharBench()` DOM patch (the specific risk this
    two-tier design exists to avoid).
  - Clicking `.char-rail-addsphere` switches `benchMode` to `'spheres'` and confirms
    `#char-build` goes empty (matches the prototype hiding the build panel during the
    sphere catalog) while `.char-bench-li` now lists sphere candidates.
  - Selecting an unblocked sphere candidate and clicking `.char-bench-acquire`: confirms
    `benchMode` returns to `'talents'`, the acquired sphere becomes `charView.sphere`, and
    `sphereEntry` now exists for it (real mutation via `tryAcquireSphere`).
  - Clicking the bench detail's Add button (`.char-bench-detail .char-btn.char-bench-add`):
    confirms the character's owned-talent count actually grew (real mutation via
    `applyTalentToggle`).
  - Confirmed `.char-sphere` class is still present on the build panel (P1/P2 guard
    dependency) and `renderSphereAcquireBar('Mente')` still returns `.sphere-acquire`
    (reading-page bar untouched).
  - **24/24 assertions passed.**

This exercises the real functions against real data, including the specific focus/caret
risk the two-tier re-render was designed for — but it's still not a substitute for a human
looking at the actual rendered layout (grid collapse at 880px, sticky rail scroll behavior,
visual states like `.blocked`/`.over`, dark mode) in a real browser.

## Browser Click-Through Checklist (for the Owner)

Use a **Feiticeiro (Sangue Feérico)** and, separately, an **Artífice** — they exercise
different paths (granted sphere / cross-section budget) already covered by the automated
tests, but need eyes on the actual layout.

**A. First look**
1. Open **Meu Personagem**, create a character (Feiticeiro, subclass Sangue Feérico,
   any level ≥ 3). Confirm the new two-column layout: left rail (tabs, identity fields,
   a collapsed "Proficiências" `<details>`, a mini-stat grid, a budget bar, and an
   "Esferas" list showing **Mente — concedida**), right side showing Mente's build panel
   on top and the bancada (search + scope chips + list + detail) below.
2. Resize the window below ~880px — confirm the layout collapses to a single column
   (rail on top, no longer sticky) and the bancada's list/detail also stack.

**B. Bancada — talents**
3. In the bancada, click a talent in the list — confirm the detail panel on the right
   shows its name, cost ("Grátis" or "Custa 1 talento mágico"), a cloned description, a
   pré-requisito line, and an Add button.
4. Click Add — confirm it appears in the build panel above ("Incluído com a esfera" or
   "Talentos" depending on grátis/extra), the budget bar in the rail updates live, and
   the bench list no longer shows that talent.
5. Type in the search box — confirm the list filters as you type **without losing focus**
   (you should be able to keep typing without re-clicking the box).
6. Toggle the scope chip to "Todas" — confirm the list now shows candidates from every
   sphere you have, each tagged with its sphere name; toggle back to see only the active
   sphere's list.
7. Find a talent with a prerequisite you don't meet yet (e.g. a level-gated one) —
   confirm it shows a 🔒 in the list and an ⚠ reason in the detail; click Add anyway and
   confirm nothing happens (a small warning note appears, no mutation). Then satisfy the
   prerequisite (e.g. add the required talent) and confirm it unlocks.
8. Remove a talent (✕ in the build panel) — confirm the budget bar goes back down.

**C. Bancada — spheres**
9. Click **"+ Adicionar esfera"** at the bottom of the rail's sphere list — confirm the
   build panel above disappears and the bancada now lists spheres you don't have yet
   (grouped implicitly magic/martial), each showing 🔒 if it's outside your remaining
   budget.
10. Select one, confirm the detail shows its description and access cost, click
    "+ Adquirir esfera" — confirm you land back in talents mode with that sphere now
    active in the rail and its build panel visible, and the budget bar reflects the cost.
11. Switch to the **Artífice** and repeat 9-10 with a martial (poder) sphere accessed via
    the magic budget (Engenhosidade-style cross-section) — confirm the rail's budget bars
    (both mágico and marcial, if applicable) reflect it correctly.

**D. Not regressed**
12. Confirm Mente (the granted sphere) still shows a package/free-pick control if
    applicable, and has **no** "Remover esfera" button (granted spheres can't be removed).
13. Switch between characters via the top tabs — confirm the rail and bancada reset to
    that character's own first sphere (not left showing the previous character's view).
14. Open any sphere chapter from the sidebar (not the sheet) and confirm the reading-page
    **acquire bar** under the chapter title still looks and behaves exactly as before this
    change (acquire/package/free-pick/remove, and the "Adicionar a…" popover when you have
    2+ characters).

## Deviations From the Brief

- `refreshCharBench()` patches `.char-build` in addition to `.char-bench` — see the
  "Note on scope" callout above under Two-Tier Re-render Strategy. Necessary for
  correctness (switching sphere via the rail must update the visible build panel); flagged
  for Arch/Richard rather than silently done.
- Added a `.char-main` wrapper div (not in the brief's explicit CSS class list) as the
  grid's second column, holding the pending-grants note + `.char-build` + `.char-bench`.
  The grid needs exactly one element per column; this is purely organizational (mirrors
  the mockup's own `.main` wrapper) and carries only `display:flex;flex-direction:column`
  styling — no behavior.
- Made `.char-rail-sphere` and `.char-rail-addsphere` `<button>` elements (the mockup uses
  plain `<div onclick>`) for keyboard accessibility, consistent with how `.charsel-tab`/
  `.char-new`/`.prof-chip` are already buttons elsewhere in this file.

## Open Questions

None blocking. One judgment call worth a look: per-sphere `_unresolvedLegacy` migration
warnings (talents from old saves that couldn't be auto-resolved) now only show when that
specific sphere is the active one in `.char-build`, instead of all being visible at once
like the old flat layout — an expected consequence of master-detail, not something I think
needs fixing, but flagging since it's a small behavior change outside the DoD checklist.
