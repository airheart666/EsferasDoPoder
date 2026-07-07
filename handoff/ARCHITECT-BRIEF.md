# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## P3 — Full in-sheet character builder

**Goal:** let the player build a whole character from the "Meu Personagem" sheet — acquire spheres,
choose packages, pick free talents, add/remove extra talents — WITHOUT leaving the sheet. Today the sheet
only displays; all management lives on the sphere *reading* pages via `renderSphereAcquireBar`. Reading
pages KEEP their acquire bar (Owner: build in the sheet AND keep the page bar).

**No new rules.** Every mutation must go through the existing enforced wrappers; the character state model
is already correct (id-based; `entry.granted`; `entry.choices.pkg`). This is UI plumbing that REUSES the
structured model + the enforcement layer.

### What exists (reuse, don't rebuild)
- `renderCharacter()` (app.js ~1570) — renders the sheet: char selector, form, stats/budget panel (via
  `Rules.slotsSpent`/`talentBudget`), then per-sphere sections with cloned talent cards + `✕` remove on
  extras. Iterates `titles = char.spheres + grantedSpheresMap keys`. `charTalentCard(fr, id, kind, title)`
  clones a talent's rendered card.
- `renderSphereAcquireBar(chapter)` (app.js:695) — the management widget on reading pages: char-target
  select, acquire button, **package selector** (`.pkg-select`, when `spec.packages`), proficiency-conditional
  notes, **free-pick selectors** (`.freepick-select`, N = `spec.freePicks`), cost, remove button. Already
  handles granted spheres (P1) and packages incl. Universal (P2).
- Enforced mutators (call these, never mutate state directly):
  `tryAcquireSphere(char,title)` (app.js:1346) → `{ok,message}`, gates on `Rules.canAccessSphere`;
  `setPackage(char,title,pkgId)` (1365); `setFreePickAt(char,title,index,talentId)` (1375) — caller must
  run `Rules.prereqCheck` first (see the reading-page handler); `addFreePickChecked`/`addExtraTalentChecked`
  (app.js ~886/897) → block + `showCharNotice` on failure; `toggleExtraTalent` (remove); `removeSphere`.
- `getSphereModel(title,pkg)` (app.js ~1500) → `{bases,freeGroup,extras,roleByKey,frag,freeLabel}` from
  structured data; `resolveSpec(char,title,choices)` (1458) → `{freePicks,packages,pkg,conditionals,...}`.
- Event wiring: reading-page controls are delegated in `setupFavorites` (handles `.acquire-btn`,
  `.pkg-select`, `.freepick-select`, char `+` buttons, `.char-target-select`, `[data-removesphere]`,
  `[data-char]` remove). The sheet's own events are wired in `setupCharacter` (app.js ~1986) on `#content`
  (char tabs, form fields, `.char-talent-remove`, delete/new).

### Build order (suggested)
1. **Refactor** the selector-building blocks out of `renderSphereAcquireBar` into small shared helpers
   (e.g. `buildPackageSelector(active,title,spec)`, `buildFreePickSelectors(active,title,spec,model)`) so
   both the reading-page bar AND the sheet render identical controls from one source. Keep the same class
   names/datasets so the existing delegated handlers keep working.
2. **In-sheet per-sphere panel**: in `renderCharacter`'s per-sphere loop, add (below the cloned cards) the
   package selector (if any), the free-pick selectors, and a new **"adicionar talento"** control — a
   compact picker of addable talents from `getSphereModel` (talents whose role is free/extra and NOT
   already owned) with `+` buttons that call `addFreePickChecked`/`addExtraTalentChecked`. Reuse
   `makeCharControl` if it fits, else a simple list.
3. **Add-sphere picker**: near the top of the spheres section, an "adicionar esfera" control listing all
   spheres (grouped magic/martial, excluding ones already had/granted) → `tryAcquireSphere`; show the
   returned `message` via `showCharNotice` on failure.
4. **Wire the sheet's events**: extend the `setupCharacter` delegated handler (or reuse `setupFavorites`'
   handlers) so the new in-sheet controls work. Simplest re-render after a mutation: call `renderCharacter()`
   (the sheet already fully re-renders); preserve the active char. Watch for the char-target select — in the
   sheet the active char IS the sheet's char, so the add controls act on `getActiveChar()`.

### Flags (don't guess — ask Arch)
- Keep the reading-page acquire bar working (shared helpers must not break it).
- All picks/acquires go through the enforced wrappers; blocked actions show `showCharNotice`.
- Don't touch `content/*.txt`, `parser.js`, the reader render, or `src/rules.js` (no rules changes).
- Don't regress P1 (granted-sphere free picks) or P2 (Universal packages) — both must work from the sheet.
- Keep `npm run validate`, `npm run typecheck`, `npm test`, and `node scripts/sanity-builder.js` green.
  app.js isn't in typecheck scope. Add sanity/rules assertions only if they fit; the main gate for P3 is
  the Owner's browser test (UI), so document exactly what to click.

### Definition of Done
- [ ] From the sheet: acquire a sphere, choose a package (Universal), pick free talent(s), add & remove
      extra talents, and see the budget update — no page navigation needed.
- [ ] Blocked picks (unmet prereq / over budget) show the notice and don't mutate state.
- [ ] Granted spheres show their free-pick selector in the sheet (P1); Universal package selector works
      in the sheet (P2).
- [ ] Reading-page acquire bar still works identically (shared helpers).
- [ ] `validate`/`typecheck`/`test`/`sanity-builder` all green.
- [ ] `handoff/REVIEW-REQUEST.md` written: files changed, the shared-helper refactor, event-wiring, and a
      precise browser click-through checklist for Richard/Owner.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

**Read:** renderSphereAcquireBar (695-826), setupFavorites (956-1062), the mutators
(1216-1526), renderCharacter (1628-1906), setupCharacter (2013-2072), style.css around
`.sphere-acquire`/`.pkg-select`/`.freepick-select`/`.char-sphere`/`.char-btn` (all styled
generically, not scoped to `.sphere-acquire` — reusable as-is in the sheet).

**Key finding:** `setupFavorites()` and `setupCharacter()` both attach delegated
listeners to the SAME `#content` element at init (app.js:102-103) and both fire on
every click/change bubbling through it, regardless of which view currently occupies
`#content`. So if the sheet reuses the exact same classes (`.pkg-select`,
`.freepick-select`, `.char-btn`), `setupFavorites`'s handlers would double-fire
alongside `setupCharacter`'s own handling. Plan: reuse the classes (for CSS + so a
human reading the DOM sees one consistent vocabulary) but disambiguate context by
ancestry — `.char-sphere` only ever exists in the sheet, `.sphere-acquire` only on
reading pages — and add one guard line to each `setupFavorites` case so it bails when
the control is inside `.char-sphere`, letting `setupCharacter` own that case fully
(mutate + `renderCharacter()` instead of `refreshSphereUI`). No dual-mutation risk,
no new DOM markers needed.

**1. Refactor (shared helpers, app.js near 695-826):**
- Extract `buildPackageSelector(active, title, spec)` — the existing `.pkg-select`
  block, returns the `<label>` or `null`.
- Extract `buildFreePickSelectors(active, title, spec, model, entry)` — the existing
  `.freepick-select` loop, returns an array of `<label>` elements (was appending
  directly to `bar`).
- Extract `applyFreePickSelection(active, title, index, talentId, anchorEl)` — the
  prereq-check-then-`setFreePickAt` logic currently inlined in `setupFavorites`'s
  change handler; returns boolean (mutated or not) so callers decide how to re-render.
- `renderSphereAcquireBar` calls all three helpers; behavior unchanged (verified by
  keeping the exact same DOM output for the reading-page case).

**2. Guard existing reading-page handlers (setupFavorites, ~1007-1033):**
- `.pkg-select` and `.freepick-select` change handlers: add `if (X.closest('.char-sphere')) return;`
  at the top of each so sheet controls don't get double-handled.
- `.char-btn` click handler (~986-997): same guard, so the sheet's "adicionar talento"
  buttons don't trigger the multi-character popover (which only makes sense on reading
  pages where the target character is ambiguous — inside the sheet it's always
  `getActiveChar()`).

**3. In-sheet per-sphere panel (renderCharacter's loop, ~1836-1894):** for each sphere
group, compute `const choices = (entry && entry.choices) || {}; const spec = resolveSpec(active, title, choices);`
and append, below the existing card boxes and above the remove button:
- `buildPackageSelector(active, title, spec)` result, if any (Universal/Alquimia).
- `buildFreePickSelectors(...)` results, if any (covers P1 granted-sphere free picks).
- A new `buildAddTalentPicker(active, title, model, entry, granted)`: filters
  `model.freeGroup.concat(model.extras)` down to ids not already in
  `entry.freePicks`/`entry.talents` and not `isGrantedTalentId`, and renders one
  `makeCharControl(item, role, active, entry, false, granted)` button per candidate
  (reuses the existing +/state logic verbatim — no new rule, just filtered to
  not-yet-owned items). Wired via the guarded `.char-btn` handler in `setupCharacter`,
  which calls `applyTalentToggle` (existing function, already does the
  free-vs-extra-vs-granted routing) then `renderCharacter()`.

**4. Add-sphere picker (top of "Esferas e talentos" section, after the h2 ~1765):**
`buildAddSpherePicker(active)` — a `<select>` with `<optgroup>`s (Esferas de
Magia/Poder) listing `dataIndex.sphereById` entries not already owned/granted, plus a
button. Click handler in `setupCharacter` reads the select value, calls
`tryAcquireSphere`, shows `showCharNotice` on failure, else `renderCharacter()`.

**5. Wiring:** all new sheet controls handled inside `setupCharacter`'s existing
click/change delegated listeners (extending them, not adding new listeners). Re-render
strategy: always `renderCharacter()` (full re-render, active char preserved via
`getActiveCharId()`/localStorage — matches the existing pattern already used by
`.char-talent-remove`/`.char-sphere-remove`/`.char-field`).

**6. CSS:** small additions in style.css near the existing `.char-sphere`/`.char-cards`
block for the new wrapper containers (`.char-sphere-manage`, `.char-add-talent`,
`.char-add-sphere`) — layout only; the inner controls (`.pkg-select` etc.) already have
global styles.

**No changes to:** src/rules.js, parser.js, content/*.txt, the reader render path, or
the shape of character state. `tryAcquireSphere`/`setPackage`/`setFreePickAt`/
`addFreePickChecked`/`addExtraTalentChecked`/`toggleExtraTalent`/`removeSphere` are
called exactly as they exist today.

**Verification:** `npm run validate`, `npm run typecheck`, `npm test`,
`node scripts/sanity-builder.js` after the change (none of them exercise app.js's DOM
wiring, so they confirm "didn't break the rules engine / data", not the new UI itself —
that needs the manual browser checklist in REVIEW-REQUEST.md).

Proceeding to build.

Architect approval: [x] Approved (proceeding per spin-up instructions) / [ ] Redirect
