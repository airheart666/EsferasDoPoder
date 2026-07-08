# Review Feedback — KG-4: Universal "Criação de Magias" (esfera dupla)

*Written by Reviewer (Richard). Read by Owner and team.*

**Date:** 2026-07-08  
**Verdict:** **SHIP** — zero blockers; all high-value checks pass.

---

## Executive Summary

All high-value checks pass. The extractor correctly handles nested parentheses and synthesizes dual-sphere prerequisites. The ~46 talent id changes are safe (no data file references to old ids; character saves degrade gracefully). The package gate correctly counts accessed magic spheres and blocks/allows selection with proper reason messages. General talents (Contrafeitiço, Foco Místico, Pacote Universal, 4 Extremo) remain available under any package. Full test suite green: 35/35 assertions + 29/29 sanity checks. No regressions detected.

---

## 1. Extractor Parse — `scripts/extract-structured.js` ✓

**Status: PASS — `lastTopParen`, `dualSpherePrereqs`, and `tagsOf` all correct.**

### Key Functions:

- **`lastTopParen(name)` (lines 62–70):** Depth-aware extraction of the last top-level paren pair. Correctly handles nested parens at depth > 0. Returns `{base, inner}` or `{base, inner: null}`.

- **`tagsOf(name)` (lines 72–82):** Uses `lastTopParen` to extract inner content, then splits on "/" and "e"/"ou" keywords. Nested "(talento)" are correctly stripped by taking only the head of each item before the inner parens.

- **`dualSpherePrereqs(name, sphereIds)` (lines 291–304):** Synthesizes sphere + talent prereqs from dual-sphere names. Tested cases:
  - Simple dual: `Aurora (esfera dupla, Luz, Clima)` → sphere prereqs for Luz + Clima ✓
  - Nested talent in dual: `Tempestade Nefasta (esfera dupla, Morte, Universal (Em Massa (metaesfera)), Clima)` → correctly parses 4 prereqs (3 spheres + 1 nested talent from Universal) ✓
  - Non-sphere descriptors stay as `{type:'text'}` in prereqs (e.g., "geomancia metálica"); flagged for manual review ✓

- **Integration (line 318–320 in `resolvePrereqs`):** Dual talents with "esfera dupla" tag invoke `dualSpherePrereqs` to inject synthesized prereqs. Unresolved items degrade to `{type:'text'}` + `_needsReview` marker ✓

- **Validation:** All 33 dual-sphere talents have ≥2 sphere prerequisites ✓

---

## 2. Id Churn (Owner-approved Global Fix) ✓

**Status: PASS — All id changes are safe; no stale references in data files.**

### Verification:

- **Scope of id churn:** ~46 talent ids across Alquimia, Destruição, Destino, Morte, and others. Old ids included garbage descriptors from nested-paren parse failures (e.g., `m-alquimia-acido-formula-arma-acido` → `m-alquimia-acido`).

- **Data file integrity:** Grep confirms ZERO references to old id patterns (`formula-arma-*` etc.) in any `data/*.json` files ✓

- **Grant talent resolution:** Class-features subclass grants (20 talent grants total) all carry resolved ids. Examples:
  - `universal-em-massa` → "Em Massa (metaesfera)" ✓
  - `vida-revitalizar` → "Revitalizar" ✓
  - Grant names stored at extract time; id is the lookup key (name descriptors added later don't break resolution) ✓

- **Character save safety:** Stale ids from older saves will be flagged by legacy-migration system (`_unresolvedLegacy`); graceful degradation per design ✓

- **Validate.js report:** 0 errors, confirming all prereq names resolve correctly ✓

---

## 3. Package Gate — `Rules.packageRequirementMet` ✓

**Status: PASS — Gate implementation is correct and robust.**

### Verification:

**Rules.packageRequirementMet (src/rules.js, lines 345–363):**
- Counts accessed MAGIC spheres via `accessedSphereIds(char, idx)` ✓
- Explicitly excludes the current sphere (`Universal`) via `if (sid === sphereId) continue;` (line 354) ✓
- Compares count against `minMagicSpheresExcludingSelf` requirement ✓
- Returns `{ok, reason}` with localized error message ✓

**buildPackageSelector (app.js, lines 708–733):**
- Checks `if (opt.requires && active && dataIndex && spec.pkg !== opt.id)` before gating (line 724)
  - Correctly skips gate check if option is already chosen (`spec.pkg !== opt.id` prevents false blocks) ✓
- Calls `Rules.packageRequirementMet` on unmet options ✓
- Disables option + appends reason to label (line 726) ✓

**setPackage (app.js, line 1414):**
- Defensive check: `if (pkgId && dataIndex && !Rules.packageRequirementMet(...).ok) return false;` ✓
- Blocks invalid selection before state mutation ✓
- Returns boolean for caller to handle ✓

**Test coverage:**
- ✓ "KG-4: Criação de Magias package BLOCKED with <2 magic spheres" (char with only Universal)
- ✓ "KG-4: Criação de Magias package ALLOWED with ≥2 magic spheres" (char with Universal + Luz + Clima)

---

## 4. Scoping Decision (b): General Talents vs Other-Package Talents ✓

**Status: PASS — Talent role classification is correct; no P2 regression.**

### Verification:

**talentRole (app.js, lines 1536–1550):**
- Line 1537: Base talents of the chosen package → `'base'` ✓
- Lines 1544–1545: Talent ignored if:
  - It has a package tag (from ANY package) AND that tag is not from the chosen package, OR
  - It is a base ability of ANOTHER package (in `allPackageBaseIds` but NOT in `baseTalentIds` of chosen pkg) ✓
- Untagged, non-base talents → remain as `'extra'` or `'free'` (available under any package) ✓

**classSpec (app.js, lines 1508–1520):**
- `allPackageTags` correctly collects all tags from all package options ✓
- `allPackageBaseIds` correctly collects all base talent ids across all packages ✓
- Returned in the spec for `talentRole` to distinguish general vs other-package talents ✓

**Data validation:**
- Under "Criação de Magias" package (talentTags: ["esfera dupla"]):
  - 33 dual-sphere talents in-scope ✓
  - 7 general talents in-scope: Contrafeitiço, Foco Místico, Pacote Universal, Duração Extrema, Oportunista Extremo, Alcance Extremo, Golpe Extremo ✓
  - 3 base talents of other packages ignored: Dissipar (dissipar pkg), Vínculo de Mana (mana pkg), Aura do Caos (magia selvagem pkg) ✓
  - All package base abilities correctly classified for each package ✓

**P2 regression check:** `npm run sanity-builder` yields 29/29 passing assertions (includes P1 granted access, P2 cross-sphere access, legacy migration) ✓

---

## 5. Green Tests & Checks ✓

| Check | Result | Details |
|-------|--------|---------|
| `npm run validate` | ✓ PASS | 0 warnings, 0 errors; all sphere prereqs resolve or degrade safely |
| `npm run typecheck` | ✓ PASS | No TypeScript errors |
| `npm test` | ✓ PASS | 35/35 assertions, including 5 new KG-4 tests (dual prereqs, gate block/allow) |
| `node scripts/sanity-builder.js` | ✓ PASS | 29/29 assertions (P1, P2, legacy migration, no regressions) |
| `node --check app.js` | ✓ PASS | Syntax valid |

### Test Coverage Detail:
- ✓ "KG-4: Aurora carries its 2 sphere prereqs (Luz + Clima)" 
- ✓ "KG-4: Aurora BLOCKED without Luz+Clima"
- ✓ "KG-4: Aurora ALLOWED with Luz+Clima"
- ✓ "KG-4: Criação de Magias package BLOCKED with <2 magic spheres"
- ✓ "KG-4: Criação de Magias package ALLOWED with ≥2 magic spheres"

---

## 6. Edge Cases & Robustness ✓

- **Dual talent with nested sphere talent:** "Tempestade Nefasta (esfera dupla, Morte, Universal (Em Massa (metaesfera)), Clima)" correctly parses with 4 prereqs (3 spheres + 1 nested talent) ✓

- **Non-sphere descriptors in dual name:** "Aprimoramento de Liga (esfera dupla, Aprimoramento, Natureza (geomancia metálica))" correctly treats "geomancia metálica" as unresolved text, flagged for manual review ✓

- **Package gate boundary:** Character with exactly 2 magic spheres (+ Universal) allows Criação de Magias; with 1 it blocks ✓

- **Legacy character saves:** Old talent ids degrade gracefully (flagged in `_unresolvedLegacy`, not silently dropped) ✓

---

## 7. Minor Notes

- 23 talents flagged with `_needsReview` remain (from earlier extraction; not introduced by KG-4). Unrelated to this change.
- CRLF warnings in git diff are Windows line-ending normalization; harmless.
- No uncommitted changes in test/build scripts; all extraction is deterministic.

---

## Sign-Off

**Verdict: SHIP**

**Blockers:** None.  
**Should-fix:** None.  
**Nits:** None.

No blockers. All load-bearing logic is correct:
- Extractor handles nested parens flawlessly ✓
- Id churn is safe (legacy fallback for saved chars) ✓
- Package gate correctly counts and blocks ✓
- Scoping preserves general talents, hides other-package talents ✓
- Full test suite green (35 + 29 assertions) ✓

Ready to merge to `master`.

---

**Reviewed by:** Richard  
**Date:** 2026-07-08
