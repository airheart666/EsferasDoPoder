# Review Request — KG-5: Metamágica restricted-allowance UI
*Written by Builder (Bob). Read by Reviewer (Richard).*

Ready for Review: YES

---

## What Was Built

A dedicated **accordion entry for Metamágica** ("✦ Metamágica — X/N escolhas") in the "Meu
Personagem" sheet, next to the sphere entries — same expand/collapse mechanism, same bench
(master-detail) pattern already used for talents/spheres. This is **UI-only**: the rules
layer (`Rules.restrictedAllowances`, `Rules.ownedTalentIds` folding in `char.metamagic`,
the general budget already not counting it) was built and tested in a prior step and is
**untouched** — `src/rules.js`, `data/`, `schema/` are not in this diff. The UI only
**consumes** `Rules.restrictedAllowances(active, dataIndex)` and reads/writes
`char.metamagic: string[]`.

For a Feiticeiro level ≥ 3 this shows a "✦ Metamágica" row in the accordion. Expanding it
shows the current picks (as cards, with a ✕ to remove) and, in the bench below, a filtered
list of Universal **metaesfera**-tagged talents to add — capped at N (2 at level 3, +1 at
10, +1 at 17), cost 0, never touching the general magic-talent budget.

## Files Changed

| File | What | Why |
|---|---|---|
| `app.js` | New module-level const `METAMAGIC_KEY = 'mm:Metamágica'` | Sentinel value for `charView.sphere` — lets the existing esfera expand/collapse machinery drive the Metamágica entry too, without a parallel state field. |
| `app.js` | New `metamagicAllowance(active)` | Thin wrapper around `Rules.restrictedAllowances(active, dataIndex)[0] \|\| null` — the single call site every other new function reads from (scope is 1 allowance today, per brief). |
| `app.js` | `buildCharBuildContent` — extended | After the sphere accordion entries, appends the Metamágica entry (expanded via `renderMetamagicPanel` or collapsed via `buildCollapsedMetamagic`) whenever `metamagicAllowance(active)` is non-null. The old "no spheres yet" early-return now also checks `!mm` so a Feiticeiro with the feature but literally zero spheres still sees the entry. |
| `app.js` | New `buildCollapsedMetamagic(active, allowance)` | Mirrors `buildCollapsedSphere` — same `.char-sphere-collapsed` markup/handler, `data-sphere="mm:Metamágica"` instead of a title, "X/N escolha(s)" instead of "N talento(s)". |
| `app.js` | New `renderMetamagicPanel(active, allowance)` | Mirrors `renderSphereBuildPanel` — same `.char-sphere` container (P1/P2's `.closest('.char-sphere')` guards stay intact) and `.char-sphere-title.char-sphere-toggle` header (collapses via the existing handler). Cards via `charTalentCard(model.frag, id, 'free', 'Universal')` (reused verbatim); removal is a dedicated `.char-mm-remove` ✕, NOT `.char-talent-remove` (which calls `toggleExtraTalent` against `spheres[].talents` — wrong array entirely). Shows a hint line while `picks.length < count`. |
| `app.js` | `buildTalentBenchPanel` — one guard added at the top | `if (charView.sphere === METAMAGIC_KEY) return buildMetamagicBenchPanel(...)` — never falls into the normal esfera/scope-candidate path for the sentinel. |
| `app.js` | New `metamagicCandidates(active, allowance)` | Filters the allowance's sphere (`Universal`) by `allowance.tag` (`metaesfera`), minus `Rules.ownedTalentIds` — which already includes `char.metamagic` AND every normal Universal pick, so dedupe in **both directions** (a Metamágica pick can't be offered again here; a normally-bought Universal talent can't be offered here either) comes for free from the existing rules-layer function, no new set-math needed. |
| `app.js` | New `buildMetamagicDetail(active, item, allowance)` | Mirrors `buildTalentDetail`'s layout (name/meta/description clone via `findCardInFrag`), but the action button is `.char-mm-add` (own class, not `makeCharControl`/`applyTalentToggle` — cost 0, outside the budget, never blocked by prereqs/section budget). Disabled with "Cota cheia" once `char.metamagic.length >= allowance.count`. |
| `app.js` | New `buildMetamagicBenchPanel(active, allowance)` | Same master-detail shell (`.char-bench-tools`/`.char-bench-list`/`.char-bench-detail`/`.char-bench-grid`) as the normal talent bench, reusing `.char-bench-li` and the search input — but the toolbar shows a single label ("Metamágica — escolha talentos (Meta) da Universal (X/N)") instead of scope chips / "+ Adicionar esfera" (neither makes sense for a one-sphere, one-tag restricted pool). |
| `app.js` | `talentCandidatesForSphere` — one line added to the `owned` set | Now also excludes `char.metamagic` ids, so a Metamágica pick can't reappear as a purchasable **extra** in Universal's normal talent list (the other half of the two-way dedupe — `metamagicCandidates` already excludes the reverse via `Rules.ownedTalentIds`). |
| `app.js` | `setupCharacter`'s existing delegated click listener — extended, not replaced | New `.char-mm-add` branch: checks `!mmAdd.disabled`, re-derives the allowance, defensively re-checks cap + tag, then `updateCharacter(active.id, { metamagic: picks.concat([id]) })` + `renderCharacter()` (mutation → full re-render, matches every other add path); over-cap shows `showCharNotice`. New `.char-mm-remove` branch: filters the id out, same update+re-render. |
| `app.js` | `normalizeCharView` — one `\|\|` clause added | `METAMAGIC_KEY` is now a valid `charView.sphere` value **only** while `metamagicAllowance(active)` is truthy — if the feature disappears (e.g. level drops below 3, or switching to a character without it), it resets exactly like a removed esfera would. |
| `app.js` | `migrateCharacters` — one line added | `if (!Array.isArray(c.metamagic)) { c.metamagic = []; changed = true; }`, alongside the existing `proficiencies`/`tradition`/`subclass` defaults. |
| `style.css` | `.char-talent-remove` rule extended to also match `.char-mm-remove` (both the flat declaration and the `.char-talent-extra >` scoped one) | Same visual, zero duplication — `renderMetamagicPanel` adds the `.char-talent-extra` class to the cloned card wrapper for the same flex layout as a normal extra-talent card. |
| `style.css` | `.char-btn.char-bench-add` selector extended to also match `.char-mm-add` (base, `:hover`, `:disabled`) | Same "Adicionar" button visual reused. `.char-mm-add` is deliberately **not** given the `.char-btn` class itself — see Decisions below. |
| `style.css` | New `.char-mm-entry` (+ `.char-sphere-collapsed.char-mm-entry:hover`) | Subtle copper accent (vs. the sphere entries' default accent color) on both the collapsed row and the expanded header, so Metamágica visually reads as a class-feature grant rather than another purchasable esfera. Optional per the brief ("só um realce... se precisar") — kept minimal. |

## Decisions Worth Flagging

- **`.char-mm-add` does not carry the `.char-btn` class.** The brief says it "pode reusar o
  visual de `.char-btn.char-bench-add`" — I read that as CSS reuse, not class reuse, and
  deliberately kept it off `.char-btn`: the pre-existing delegated handler
  `cbtn.closest('.char-btn') && cbtn.closest('.char-bench')` calls
  `applyTalentToggle(active, title, JSON.parse(cbtn.dataset.char), ...)`, and a `.char-mm-add`
  button only has `dataset.id` (no `dataset.char`/`dataset.sphere`) — sharing the class would
  have made every Metamágica add attempt throw on `JSON.parse(undefined)`. CSS instead adds
  `.char-mm-add` directly to the `.char-btn.char-bench-add` selector list.
- **Kept the search input in the Metamágica bench toolbar**, even though the brief's toolbar
  description only mentions a label. It's the same `.char-bench-search` element already wired
  to the existing `input` listener (`refreshCharBench`) — costs nothing extra, matches the
  normal bench's UX. Flag it if you'd rather it be dropped for stricter fidelity to "só um
  rótulo".
- **`metamagicAllowance` takes `[0]` of `Rules.restrictedAllowances`.** Scope is 1 allowance
  today (only Metamágica exists) per the brief. If a second restricted-allowance feature is
  ever added, this is the seam that needs to grow into a feature-keyed lookup — not attempted
  here, correctly out of scope.

## Not Regressed (verified, see below)

- **Sphere accordion** — untouched code paths (`renderSphereBuildPanel`, `buildCollapsedSphere`,
  `.char-sphere-collapsed`/`.char-sphere-toggle` handlers) still drive title-keyed spheres
  exactly as before; the Metamágica entry only ever appends after them.
- **Bench (talents mode)** — `buildTalentBenchPanel`'s normal body is unchanged except for the
  one early-return guard at the top; a character without the Metamágica feature (or with
  `charView.sphere` pointing at a real esfera) never touches any of the new code.
- **Bench (spheres mode)** — `buildSphereBenchPanel`/`buildSphereDetail` untouched.
- **P1/P2** (granted-sphere free picks, Universal package selection) — `renderSphereBuildPanel`'s
  `.char-sphere-manage` block and the `.char-sphere` class/`.closest('.char-sphere')` guards are
  byte-identical to before this change.
- **Reading-page acquire bar** (`renderSphereAcquireBar`/`setupFavorites`) — not touched at all.

## How This Was Verified

- `npm run validate` — 0 errors (unaffected, doesn't touch app.js).
- `npm run typecheck` — green (app.js is out of `checkJs` scope).
- `npm test` (`scripts/test-rules.js`) — **30/30**, including the pre-existing
  "Metamágica does NOT add to general magic budget" / "Metamágica surfaces as a restricted
  allowance" / "Metamágica allowance count = 2 at lvl5" cases from the rules-layer step this
  UI consumes (all still pass — confirms nothing here needed rules changes).
- `node scripts/sanity-builder.js` — **29/29** (confirms `migrateCharacters` now seeds
  `metamagic: []` on legacy characters, alongside all pre-existing scenarios).
- `node --check app.js` — clean.
- **New jsdom smoke test** (written during the build, same technique as
  `scripts/sanity-builder.js` — loads the real `parser.js`/`chapters.js`/`src/rules.js`/
  `src/data.js`/`app.js` into a jsdom `vm` context, not committed as a script but fully
  reproducible from this description): created a level-5 **Feiticeiro (Sangue Feérico)**
  (Metamágica count = 2), called the real `setupCharacter()` + `renderCharacter()`, and
  dispatched real `click` DOM events:
  - Entry appears collapsed, "0/2" — clicking it expands the panel (header also reads "0/2"),
    and the bench toolbar shows the "Metamágica — escolha talentos (Meta) da Universal (0/2)"
    label.
  - Selected a bench candidate, confirmed its detail shows an **enabled** `.char-mm-add`
    button ("Adicionar (Metamágica)"); clicked it — the id landed in `char.metamagic`, the
    header updated to "1/2", and `Rules.slotsSpent(active, dataIndex).magic` was **identical**
    before and after (general budget genuinely untouched).
  - Confirmed the panel **stays expanded** across the full `renderCharacter()` re-render
    triggered by the add (normalizeCharView correctly keeps `METAMAGIC_KEY` valid while the
    allowance exists).
  - Picked a second (different) candidate — header reached "2/2".
  - Selected a third candidate: `.char-mm-add` was **disabled**, labeled "Cota cheia"; clicking
    it anyway was a confirmed no-op (`char.metamagic.length` stayed 2).
  - **Dedupe, both directions:** acquired Universal normally (`tryAcquireSphere`), confirmed
    `talentCandidatesForSphere(active, 'Universal')` does **not** offer either Metamágica pick
    as a purchasable extra. Then took a *different* metaesfera-tagged talent as a normal
    Universal extra pick (`addExtraTalentChecked`), and confirmed `metamagicCandidates`
    immediately stopped offering it in the Metamágica bench.
  - Clicked `.char-mm-remove` on a pick's card in the ficha — confirmed it left
    `char.metamagic`, the header dropped back to "1/2", and the removed talent reappeared as
    a Metamágica bench candidate.
  - Created a fresh **level-1 Feiticeiro** (no Metamágica yet) — confirmed
    `metamagicAllowance` returns `null` and the accordion shows **no** `mm:Metamágica` entry
    at all.
  - **26/26 assertions passed.**

This exercises the real functions against real data end-to-end, but it's still not a
substitute for a human looking at the actual rendered accordion entry, card layout, and dark
mode in a real browser.

## Browser Click-Through Checklist (for the Owner)

Use a **Feiticeiro, subclass Sangue Feérico, level ≥ 3** (Metamágica is active at level 3+;
try level 10 or 17 too if you want to see the count grow to 3/4).

1. Open **Meu Personagem**, create the character. In the accordion (below the identity/stats
   rail), scroll to the bottom of the sphere list — confirm a **"✦ Metamágica — 0/2
   escolha(s)"** row appears, visually distinct (copper accent) from the sphere rows above it.
2. Click it — confirm it expands like any sphere (the previously-expanded sphere, if any,
   collapses), showing an empty "Escolhidos" area and a hint like "Escolha 2 talento(s) de
   metaesfera na bancada abaixo."
3. In the bancada below, confirm the toolbar reads something like "Metamágica — escolha
   talentos (Meta) da Universal (0/2)" with **no** scope chips and **no** "+ Adicionar esfera"
   button (unlike the normal talent bench).
4. Click a talent in the list — confirm the detail shows its name, "Universal · Metamágica ·
   grátis — fora do orçamento geral", the full cloned description, and an **"Adicionar
   (Metamágica)"** button.
5. Click it — confirm: the talent appears as a card under "Escolhidos" in the panel above
   (with a ✕), the header/collapsed count go to "1/2", and the **magic budget bar in the
   rail does NOT move** (this is the whole point of the feature — it must stay unaffected).
6. Repeat to reach "2/2". Select a third candidate (if the sphere has more metaesfera talents
   left) — confirm its Add button is **disabled** and reads "Cota cheia".
7. Click the ✕ on one of the two chosen cards — confirm it's removed, the count drops to
   "1/2", and the talent is offered again in the bench below.
8. Acquire the **Universal** sphere normally (via "+ Adicionar esfera" on a different, real
   sphere entry) and open its own talent list in the bench — confirm your remaining
   Metamágica pick does **not** show up there as a normal purchasable extra. Conversely, buy a
   *different* metaesfera-tagged Universal talent normally (as an extra) — confirm it
   disappears from the Metamágica bench's candidate list (it's already yours either way).
9. Change the character's level to **1** (or switch to a non-Feiticeiro character) — confirm
   the "✦ Metamágica" entry disappears entirely from the accordion, and if it happened to be
   the expanded entry, the sheet doesn't break (falls back to no sphere expanded / the first
   available one).
10. Confirm nothing else regressed: sphere accordion expand/collapse, the bench in talents/
    spheres mode, a granted sphere's free-pick selector (P1), a Universal package selector
    (P2), and the reading-page acquire bar under any sphere chapter — all exactly as before.

## Open Questions

None blocking. Two small judgment calls are called out above under "Decisions Worth
Flagging" (the search box in the Metamágica toolbar, and the `.char-mm-add`/`.char-btn`
class split) — flagging for visibility, not because I think either needs to change.
