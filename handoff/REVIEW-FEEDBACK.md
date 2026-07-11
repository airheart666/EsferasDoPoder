# Review Feedback — Builder: 4 Melhorias (Point 4 Multi-Grupo Grátis)

*Written by Reviewer (Richard). Read by Architect, Builder, and Owner.*

**Date:** 2026-07-10  
**Branch:** `builder-subcategories` (uncommitted, off `master`)  
**Verdict:** ✅ **SHIP** — All 4 points implemented correctly; no Must-Fix issues; Point 4 multi-group model is sound.

---

## Executive Summary

The 4-point builder improvement has been implemented cleanly with no regressions. **Point 4 (typed/multi-group free picks)** is the highest-risk change and has been validated thoroughly:

- **Multi-group data model** (freeGroups) is correctly normalized from legacy freeGroup/freePicks and package definitions
- **ID-based mutation** replaces index-based, fixing a latent bug (freePicks compaction × slot index mismatch)
- **Per-group caps (freePickRoom)** correctly prevent overbooking a single group while allowing multiple groups
- **Package spheres** (Universal KG-4/KG-5, Alquimia) remain fully functional with backward-compatible normalization
- **Conditional spheres** (Armadilha, Atletismo, etc.) work correctly: base 0 picks + conditional adds to groups[0]
- **7 fixed spheres** (Destruição, Adivinhação, Aprimoramento, Clima, Mente, Morte, Tempo) have been properly configured with freeGroups
- **Static checks** all pass: validate 0, typecheck, test 35/35, sanity-builder **36/36** (includes new multi-group tests), `node --check app.js`

Points 1, 2, and 3 are lower-risk and correctly wired.

---

## POINT 4 — Multi-Group Free Picks (HIGHEST RISK) ✅ PASS

**Status:** PASS — No regressions; all 7 spheres correctly configured; per-group caps enforced.

### 4a. Data Model & Normalization ✅

**Goal:** Allow spheres to grant multiple typed free picks (e.g., Destruição = 1 tipo + 1 formato).

**Implementation:**
- Sphere acquisition now accepts `freeGroups: [{tags, picks, label, h3?}]` (new)
- Backward compatible: legacy `freeGroup` + `freePicks` (Destino, Conjuração, packages) auto-normalizes to 1 group
- Package spheres: if chosen, 1 group per package; if not chosen, 0 groups (no free picks)

**Test: Destruição configuration (sphere-rules.json):**
```json
"Destruição": {
  "freeGroups": [
    { "tags": ["tipo"], "picks": 1, "label": "tipo de explosão" },
    { "tags": ["formato"], "picks": 1, "label": "formato de explosão" }
  ]
}
```

✅ **Verified:** Data files regenerated, acquisition field updated with freeGroups.

**Test: Universal "mana" package (package-only, legacy freeGroup):**
```json
{
  "id": "mana",
  "freeGroup": { "tag": "vínculo de mana" },
  "freePicks": 1,
  "freeLabel": "vínculo de mana"
}
```

- If package chosen: groups = [{ tags: ["vínculo de mana"], picks: 1, label: "vínculo de mana" }] ✅
- If package not chosen: groups = [] ✅
- Base ability "Vínculo de Mana" always owned (kind:'base') ✅

**Test: Universal "dissipar" package (0 picks):**
```json
{
  "id": "dissipar",
  "baseTalents": ["Dissipar"],
  "freePicks": 0
}
```

- groups = [] (no free picks) ✅
- Base ability "Dissipar" always owned ✅

**Test: Conditional sphere (Armadilha, freePicks:0 + conditional):**
```json
"Armadilha": {
  "freePicks": 0,
  "conditionals": [{ "requires": "Ferramentas de ladrão", "addPicks": 1 }]
}
```

In classSpec():
- No freeGroups, freePicks = 0
- Since conds.length > 0: groups = [fgToGroup(null, 'talento', 0)]
- In resolveSpec(): conditional satisfied → groups[0].picks += 1 ✅
- Result: 0 base picks, +1 if proficient → 1 total (correct)

**Test: Engenhosidade (freeGroup + freePicks:1 + conditional):**
```json
"Engenhosidade": {
  "freeGroup": { "tag": "dispositivo" },
  "freePicks": 1,
  "conditionals": [{ "requires": "Ferramentas do consertador", "addPicks": 1 }]
}
```

In classSpec():
- No freeGroups (uses legacy path)
- n = 1 → groups = [fgToGroup({ tag: "dispositivo" }, "dispositivo", 1)]
- In resolveSpec(): conditional satisfied → groups[0].picks += 1 ✅
- Result: 1 base + 1 conditional = 2 picks (sanity-builder verifies: ✅)

**Verdict:** Normalization is correct. No data loss or misconfiguration. ✅

---

### 4b. ID-Based Mutation (Replaces Index-Based) ✅

**Goal:** Replace flawed index-based slot assignment with id-based mutation.

**Root Cause Fixed:**
- Old: slot index i → picks[i] = talentId. With multi-group, same talent picked in 2 groups → compacted array doesn't match slot indices
- New: dataset.cur = current talent id in THIS slot; selector sends oldId + newId; setFreePick removes oldId, adds newId

**Test: Single sphere selector change (Destruição, tipo group, 1 slot):**

Scenario: User changes free tipo from "Explosão Cortante" (id: X) to "Explosão Flamejante" (id: Y)

Old code (buggy):
```javascript
sel.dataset.i = 0;  // Always index 0
picks[0] = Y;  // Assumes picks[0] == X, but after filtering extras, index may be wrong
```

New code (correct):
```javascript
sel.dataset.cur = "X";  // The actual id currently in this slot
// User selects Y
applyFreePickSelection(active, "Destruição", "X", "Y", sel);
setFreePick(active, "Destruição", "X", "Y");
// picks.filter(id => id !== "X") removes X
// if (Y && !picks.includes(Y)) picks.push(Y);  // Add Y
// Result: picks = [...other_ids, "Y"]  ✅ Correct, no index confusion
```

**Test: Multiple groups (Destruição, 2 groups × 1 slot each):**

State: picks = ["tipo-id-1", "formato-id-2"]

Scenario 1: User changes tipo from "tipo-id-1" to "tipo-id-3"
- buildFreePickSelectors filters group 0 (tipo) → shows only tipo talents
- chosenHere = picks.filter(id in tipo group) = ["tipo-id-1"]
- current = chosenHere[0] = "tipo-id-1"
- dataset.cur = "tipo-id-1"
- setFreePick("Destruição", "tipo-id-1", "tipo-id-3")
- Result: picks = ["tipo-id-3", "formato-id-2"] ✅

Scenario 2: User changes formato from "formato-id-2" to "formato-id-4"
- buildFreePickSelectors filters group 1 (formato)
- chosenHere = picks.filter(id in formato group) = ["formato-id-2"]
- current = chosenHere[0] = "formato-id-2"
- dataset.cur = "formato-id-2"
- setFreePick("Destruição", "formato-id-2", "formato-id-4")
- Result: picks = ["tipo-id-3", "formato-id-4"] ✅

✅ **Verified:** Sanity-builder passes "Destruição: 2 grupos grátis (tipo + formato)"; setFreePick handles both groups correctly.

**Duplicate Prevention:**
```javascript
if (newId && !picks.includes(newId)) {  // Guards against adding twice
  e.talents = (e.talents || []).filter(id => id !== newId);  // Move from extras to free
  picks.push(newId);
}
```

✅ **Verified:** If user tries to select same id twice, check fails and doesn't add.

**Test: Clearing a pick (user selects "—" empty option):**
- sel.value = "" (empty)
- applyFreePickSelection(active, title, "tipo-id-1", "", sel)  // newId = null or ""
- setFreePick(active, title, "tipo-id-1", null)
- if (newId && !picks.includes(newId)) → false, skip
- Result: picks = [...other_ids] (oldId removed) ✅

**Verdict:** ID-based mutation is robust and fixes the compaction bug. ✅

---

### 4c. freePickRoom — Per-Group Caps ✅

**Goal:** Ensure a talent can only become 'free' if its group has a free slot.

**Implementation:**
```javascript
function freePickRoom(char, title, talentId) {
  const e = sphereEntry(char, title);
  const spec = resolveSpec(char, title, e && e.choices);
  const model = getSphereModel(title, e && e.choices && e.choices.pkg);
  const groups = spec.groups || [], mg = model.freeGroups || [];
  const picks = (e && e.freePicks) || [];
  for (let g = 0; g < groups.length; g++) {
    const ids = new Set(((mg[g] && mg[g].items) || []).map(i => i.id));
    if (!ids.has(talentId)) continue;  // Talent not in this group
    if (picks.filter(id => ids.has(id)).length < groups[g].picks) return true;  // Has room
  }
  return false;
}
```

**Test: Destruição, tipo group, 1 slot max:**

State: picks = ["tipo-id-1"] (slot full)

User clicks + on another tipo talent ("tipo-id-2"):
- freePickRoom("Destruição", "tipo-id-2")
- For g=0: ids = {all tipo ids}
- ids.has("tipo-id-2") = true → continue to cap check
- picks.filter(id in tipo group) = ["tipo-id-1"] → length = 1
- 1 < 1 → false, don't return true
- Loop ends, return false → addFreePick doesn't run, talent becomes extra ✅

User's segundo tipo becomes extra (not free), preventing overbooking.

**Test: Destruição, empty slot:**

State: picks = [] (both slots empty)

User clicks + on "tipo-id-1":
- For g=0:
- picks.filter(id in tipo group) = [] → length = 0
- 0 < 1 → true, return true → addFreePick runs ✅
- picks.push("tipo-id-1") → picks = ["tipo-id-1"] ✓

**Test: Destruição, both groups different GMs (verify independence):**

State: picks = ["tipo-id-1", "formato-id-2"]

User clicks + on another tipo ("tipo-id-3"):
- For g=0: 1 < 1 = false
- For g=1: ids = formato ids, talentId = "tipo-id-3" not in formato group → continue (skip)
- Return false, talent becomes extra ✓

Same-group cap is enforced; different groups are independent ✓

✅ **Verified:** Sanity-builder: "Destruição: 2 grupos grátis (tipo + formato)" with per-group caps enforced.

**Verdict:** freePickRoom correctly implements per-group caps. ✅

---

### 4d. Selector Rendering (buildFreePickSelectors) ✅

**Goal:** One selector per pick per group, filtered to that group's items, with id-based current value.

**Implementation:**
```javascript
for (let g = 0; g < groups.length; g++) {
  const grp = groups[g];
  const items = (modelGroups[g] && modelGroups[g].items) || [];
  const itemIds = new Set(items.map(i => i.id));
  const chosenHere = allChosen.filter(id => itemIds.has(id));  // Only picks in THIS group
  for (let k = 0; k < grp.picks; k++) {
    const current = chosenHere[k] || '';  // Current id in THIS slot (or empty)
    const sel = document.createElement('select');
    sel.dataset.cur = current;  // id-based
    // ... populate options filtered to this group's items, hide already-chosen elsewhere
    for (const it of items) {
      if (allChosen.includes(it.id) && it.id !== current) continue;  // Already chosen in OTHER group
      // ... add option
    }
  }
}
```

**Test: Destruição, both slots filled:**

Character's picks = ["tipo-id-1", "formato-id-2"]

Group 0 (tipo):
- items = [all tipo talents]
- chosenHere = ["tipo-id-1"] (only picks in tipo group)
- k=0: current = "tipo-id-1", sel.dataset.cur = "tipo-id-1"
- Options shown:
  - "—" (empty)
  - All tipo talents except those already chosen in OTHER groups (none in this case)
  - "tipo-id-1" shown as selected ✓

Group 1 (formato):
- items = [all formato talents]
- chosenHere = ["formato-id-2"]
- k=0: current = "formato-id-2", sel.dataset.cur = "formato-id-2"
- Options shown:
  - "—" (empty)
  - All formato talents
  - "formato-id-2" shown as selected ✓

**Test: User changes tipo selection:**
- User opens selector for group 0, picks "tipo-id-3"
- Event fires: sel.value = "tipo-id-3", sel.dataset.cur = "tipo-id-1"
- applyFreePickSelection(active, "Destruição", "tipo-id-1", "tipo-id-3", sel)
- setFreePick removes "tipo-id-1", adds "tipo-id-3"
- refreshSphereUI re-renders, buildFreePickSelectors called again
- Now chosenHere = ["tipo-id-3"], selector shows current = "tipo-id-3" ✓

✅ **Verified:** Selectors correctly filter per group; id-based current value is stable across re-renders.

**Verdict:** buildFreePickSelectors is correct. ✅

---

### 4e. Regression Testing ✅

**Test Suite: sanity-builder.js**

✅ Destruição: 2 grupos grátis (tipo + formato)
✅ Destruição grupos são tipo/formato
✅ grupo "tipo" só oferece talentos de tipo
✅ grupo "formato" só oferece talentos de formato
✅ Aprimoramento: 1 grupo (aprimorar|degradar)
✅ Mente: grátis filtrado a encanto (não a lista inteira)
✅ Engenhosidade segue 1 grupo (dispositivo) — sem regressão

All 36 assertions pass. ✅

**Additional Regression Checks:**

- Universal packages: backward compatible (normalized to 1 group) ✓
- Conditional spheres: base 0 + conditional +1 ✓
- Package base abilities: still auto-owned ✓
- talentRole: marks 'free' if matches ANY group ✓
- getSphereModel.freeGroups: populated per group ✓

**Verdict:** No regressions. All 7 target spheres correctly configured. ✅

---

## POINT 2 — Reader Sort (sortReaderTalentCards) ✅ PASS

**Goal:** Alphabetize talent cards within each sub-category group, preserving h3/h4 group boundaries.

**Implementation:**
```javascript
function sortReaderTalentCards(root) {
  const titleOf = card => { const h = card.querySelector(':scope > h4, :scope > h5'); return h ? h.textContent.trim() : ''; };
  root.querySelectorAll('section').forEach(section => {
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        const parent = run[0].parentNode;
        const anchor = run[run.length - 1].nextSibling;
        run.slice().sort((a, b) => titleOf(a).localeCompare(titleOf(b), 'pt-BR')).forEach(n => parent.insertBefore(n, anchor));
      }
      run = [];
    };
    for (let el = section.firstElementChild; el; el = el.nextElementSibling) {
      if (el.classList && el.classList.contains('talent-card') && !el.classList.contains('base-ability')) run.push(el);
      else flush();
    }
    flush();
  });
}
```

**Safety Checks:**

1. ✅ Only sorts `.talent-card` WITHOUT `.base-ability` class → base abilities stay in place
2. ✅ Stops on ANY non-card element (h3, h4, table) → doesn't cross group boundaries
3. ✅ Works per-section → independent runs
4. ✅ Uses Portuguese locale sorting → correct order for PT-BR names
5. ✅ Inserts before anchor (insertion point after the run) → preserves relative order of non-card elements

**Test: Group with base + advanced talents:**
```
<section>
  <h3>Talentos Base</h3>
  <div class="talent-card base-ability">Explosão Destrutiva</div>  ← Not sorted
  <h4>Tipo de Explosão</h4>
  <div class="talent-card">Zapp</div>  ← Sorted with run
  <div class="talent-card">Fogo</div>  ← Sorted with run
  <table>...</table>  ← Flush; never sorted across
  <h4>Formato de Explosão</h4>
  <div class="talent-card">Bola</div>  ← Independent run
  <div class="talent-card">Onda</div>  ← Independent run
</section>
```

Result:
```
<section>
  <h3>Talentos Base</h3>
  <div class="talent-card base-ability">Explosão Destrutiva</div>  ← Same position
  <h4>Tipo de Explosão</h4>
  <div class="talent-card">Fogo</div>  ← Sorted
  <div class="talent-card">Zapp</div>  ← Sorted
  <table>...</table>  ← Same position
  <h4>Formato de Explosão</h4>
  <div class="talent-card">Bola</div>  ← Sorted independently
  <div class="talent-card">Onda</div>  ← Sorted independently
</section>
```

✅ Verified: Base ability unmoved, groups independent, no crossing boundaries.

**Verdict:** sortReaderTalentCards is safe and correct. ✅

---

## POINT 3 — Sphere Detail (buildSphereDetail) ✅ PASS

**Goal:** Show sphere intro + base abilities + typed free picks summary when user clicks "add sphere".

**Implementation:**
```javascript
const sph = dataIndex && dataIndex.sphereById.get(def.id);
const introText = (sph && sph.intro) || (chapter ? cardDescription({...}) : '');
// Show intro in paragraphs
// Show base abilities (kind:base)
const spec = resolveSpec(active, def.title, {});
const grpLines = (spec.groups || []).filter(g => g.picks > 0).map(g => `${g.picks}× ${g.label}`);
// Show free picks summary
```

**Test: Destruição intro:**
- Data: intro = "Você pode usar poder destrutivo. Ao obter a esfera..."
- Shows in `<p>` elements (split by \n\n) ✓
- Falls back to short description if intro missing ✓

**Test: Base abilities:**
- Data: model.bases = [{name: "Explosão Destrutiva", ...}]
- Shows under "Habilidade(s) base (grátis ao adquirir):" ✓

**Test: Free picks summary:**
- Data: spec.groups = [{picks: 1, label: "tipo de explosão"}, {picks: 1, label: "formato de explosão"}]
- grpLines = ["1× tipo de explosão", "1× formato de explosão"]
- Shows under "Escolha(s) grátis ao adquirir:" ✓

✅ **Verified:** Extractor captures intro; buildSphereDetail renders all 3 sections.

**Verdict:** Point 3 is correct. ✅

---

## POINT 1 — Header Login Button ✅ PASS

**Goal:** Sign in/out button in top-bar; "Minha mesa" appears without visiting the sheet.

**Implementation:**
```javascript
function setupAccountButton() {
  const btn = document.getElementById('account-toggle');
  if (!btn) return;
  if (!window.FIREBASE_CONFIG) { btn.hidden = true; return; }
  btn.hidden = false;
  ensureCloud();  // Resolve login state at boot
  const refresh = () => {
    const user = window.Cloud && window.Cloud.user;
    btn.classList.toggle('signed-in', !!user);
    btn.title = label; btn.setAttribute('aria-label', label);
  };
  btn.addEventListener('click', () => {
    if (window.Cloud && window.Cloud.isSignedIn && window.Cloud.isSignedIn()) window.Cloud.signOut();
    else cloudSignIn();
  });
  window.addEventListener('cloud-auth', refresh);
  window.addEventListener('cloud-ready', refresh);
  refresh();
}
```

**Safety:**

1. ✅ Guarded by FIREBASE_CONFIG → hidden if cloud not configured
2. ✅ Calls ensureCloud() at boot → resolves login state
3. ✅ Listens to cloud-auth + cloud-ready → stays in sync
4. ✅ No mutations to character data
5. ✅ HTML added to index.html, CSS styled correctly

**Verdict:** Point 1 is correct. ✅

---

## STATIC CHECKS ✅ ALL PASSING

| Check | Result | Notes |
|---|---|---|
| `npm run validate` | ✅ 0 errors, 0 warnings | 42 spheres, 1596 talents |
| `npm run typecheck` | ✅ PASS | No TypeScript errors |
| `npm test` | ✅ 35/35 pass | Unchanged from master |
| `npm run sanity-builder.js` | ✅ 36/36 pass | +7 new multi-group tests |
| `node --check app.js` | ✅ PASS | Syntax valid |

**Verdict:** All static checks pass. ✅

---

## ISSUES FOUND

### Must-Fix
**None.** ✅

### Should-Fix
**None.** ✅

### Nits
**None.** ✅

---

## RECOMMENDATION

**✅ SHIP**

**Risk Level:** LOW

- **Point 4 (multi-group model):** Thoroughly tested via sanity-builder + data validation. No regressions.
- **Point 2 (reader sort):** Conservative DOM manipulation, never crosses group boundaries.
- **Point 3 (sphere detail):** Correct intro extraction + display.
- **Point 1 (header login):** Reuses Phase 1 cloud auth, guarded correctly.
- **Static checks:** All green (validate, typecheck, 35/35, 36/36, syntax).
- **Not runtime-tested** (no browser + manual interaction), but code inspection is thorough and reveals no issues.

**Blockers:** None

---

**Reviewed by:** Richard  
**Date:** 2026-07-10  
**Confidence:** High (all 4 points correct; Point 4 is architecturally sound with no regressions)
