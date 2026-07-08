# Review Request — KG-4: Universal "Criação de Magias" (esfera dupla)
*Written by Architect (implemented inline). Read by Richard.*

Ready for Review: YES

---

## What Was Built

Finalizes KG-4: the Universal **Criação de Magias** package's dual-sphere ("esfera dupla")
talents now (1) are all VISIBLE and (2) ENFORCE their required spheres; plus (a) a package
selection gate (≥2 magic spheres) and (b) general Universal talents available regardless of
package. Owner-decided both forks. Uncommitted on branch `kg4-criacao-magias` (off `master`).

## Root cause + core fix (extractor)

`scripts/extract-structured.js` — `baseName`/`tagsOf` used a simple regex (`\(([^)]*)\)`)
that **broke on nested parens**, so ~10 dual talents (e.g. `Transformar Objeto (esfera dupla,
Alteração, Aprimoramento (Animar Objeto))`) got empty tags (→ hidden by the package's
`tag:"esfera dupla"` filter) and mangled ids; the other ~23 had tags but empty prerequisites.
- New `lastTopParen(name)` (depth-aware) → `baseName`/`tagsOf` rebuilt on it (reuses `splitTopLevel`).
- New `dualSpherePrereqs(name, sphereIds)` synthesizes `{type:'sphere'}` (+ nested `{type:'talent'}`)
  prereqs from the name clause; descriptors ("socorro", "forma de explosão") stay tags. Hooked into
  the existing `resolvePrereqs` 2nd pass (name→id; unresolved → text + `_needsReview`, degrade-safe).
- **Owner-approved scope:** the same nested-paren bug affected 47 non-dual talents across
  Alquimia/Destruição/Destino/Proteção/Morte/etc. (garbage ids, empty tags — Alquimia's fórmula
  talents were mis-scoped). The global fix cleans all: **46+ talent ids change** (id churn for saved
  chars is non-destructive — stale ids just render via the fallback until re-added). `validate` 0 errors.

## The rest

- **(a) Package gate** — `sphere-rules.json` criacao-magias `"requires":{"minMagicSpheresExcludingSelf":2}`
  (+ regen data, `schema/sphere.schema.json`, `src/types.js`). `src/rules.js` new
  `packageRequirementMet(char, sphereId, pkgId, idx)` (counts accessed magic spheres ≠ Universal),
  exported. `app.js`: `buildPackageSelector` disables the gated option + reason; `setPackage` blocks
  it defensively (returns false).
- **(b) General talents** — `app.js` `classSpec` now exposes `allPackageTags` + `allPackageBaseIds`;
  `talentRole` ignores a talent only if it belongs to ANOTHER package (has a package tag ≠ chosen, OR
  is another package's base ability). Untagged non-base talents (Contrafeitiço, Foco Místico, Pacote
  Universal, the 4 "Extremo") are now in-scope under any package. Verified: under Criação de Magias →
  33 dual in-scope, exactly 7 general in-scope, package bases (Dissipar/Vínculo/Aura) correctly excluded.
- **Validation/tests** — `scripts/validate.js`: every "esfera dupla" talent must resolve ≥2 sphere
  prereqs (0 warnings → all 33 pass). `scripts/test-rules.js`: +5 assertions (Aurora blocked without
  Luz+Clima / allowed with; package gate false <2 magic / true ≥2).

## Files changed
`scripts/extract-structured.js`, `data/spheres/*.json` (regen), `sphere-rules.json`,
`schema/sphere.schema.json`, `src/rules.js`, `src/types.js`, `app.js`, `scripts/validate.js`,
`scripts/test-rules.js`. No `content/*.txt`, no `parser.js`, no reader-render changes.

## Review focus
1. **Extractor parse** — `lastTopParen`/`dualSpherePrereqs` correctness; nested `Sphere (talent)` and
   double-nested `Universal (Em Massa (metaesfera))` resolve; descriptors not turned into bad prereqs.
2. **Id churn** — is any changed id referenced by something OTHER than saved localStorage chars (grants/
   package baseTalents resolve by NAME, so should be safe — `validate` 0 errors confirms integrity)?
3. **Package gate** — `packageRequirementMet` counts correctly (excludes Universal); selector disables +
   `setPackage` blocks; no false block when the package is already chosen.
4. **Scoping (b)** — general vs other-package logic in `talentRole`; no P2 regression (sanity 29/29).
5. Green: `validate` 0/0, `typecheck`, `test` 35/35, `sanity` 29/29, `node --check app.js`.

## Verification done
`npm run validate` 0/0 · `typecheck` green · `npm test` 35/35 · `sanity-builder` 29/29 · app.js parses ·
ad-hoc scoping simulation over real data (33 dual + 7 general + 38 other-package correctly classified).
Not a substitute for the Owner's browser click-through (package gate UI, dual talents appearing, general
talents under a package). No commit made.
