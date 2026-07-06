# Review Feedback — Phase 3 Step 4
*Written by Reviewer (Richard). Read by Builder and Architect.*

Date: 2026-07-06  
Ready for Merge: **YES**

---

## Verdict

**SHIP.** Wiring is correct, enforcement is sound, migration is non-destructive and idempotent. All tests pass (validate, typecheck, test, sanity-builder.js). Brief adherence complete.

---

## Must Fix

None.

---

## Should Fix

None. Known gaps (KG-2: ownedTalentIds limitation; KG-3: homonym legacy items left unresolved) are pre-approved in brief — acceptable, documented, non-regressions.

---

## Escalate to Architect

None. All decisions locked in brief and honored in code.

---

## What Was Verified

**Automated tests** (all passing):
- `npm run validate` — 0 errors
- `npm run typecheck` — green
- `npm test` — 12/12 assertions
- `node scripts/sanity-builder.js` — 23/23 assertions covering: data loading, prereq enforcement (blocked → allowed), talent-slot budget (filled → overflow blocked), sphere-access budget (acquired → overflow blocked), granted sphere access (free, no-op on re-acquire), migration (title→id, object→id, unresolved items kept + flagged, idempotent)

**Code review** (critical paths):
1. **Enforcement** (addFreePickChecked, addExtraTalentChecked, tryAcquireSphere): All call Rules.* checks before state mutation; unverified text-prereqs show as "confirm manually" warnings (never block); removal paths never gated
2. **Classification parity** (talentRole vs old cardRole): Structural role reads talent.kind/tags/group (not DOM); display role bridges DOM card to structured talent id, applies grant override; matchesFreeGroupStructured reads talent.tags/group (pre-verified equivalence with old DOM scraping)
3. **Migration** (non-destructive, idempotent): Converts spheres[].sphere title→id via `sphereIdByTitle`; converts freePicks/talents objects→ids via exact-name match (no guessing); unresolvable items kept in `_unresolvedLegacy`, never dropped; flagged unresolved spheres with `_needsReview`; skips to next attempt if dataIndex failed; mixed input (strings + objects from partial prior migrations) handled correctly
4. **Data shape**: char.spheres[].sphere now id (not title), freePicks/talents now id strings (not objects) — matches Rules.Character input shape
5. **Reader safety**: No changes to content/*.txt, parser.js, chapters.js; only two script tags (src/rules.js, src/data.js before app.js); only one CSS rule (.char-warn-toast, reuses .char-warn styling)

---

## Code Quality Notes

**Strengths:**
- Bridge functions (sphereIdFor, sphereByTitle, resolveTalentId, resolveTalentIdLoose) centralize title↔id conversion — single point of concern
- showCharNotice reuses existing .char-warn styling, auto-dismisses after 4.5s (non-intrusive)
- Migration preserves original shape of unresolvable items — zero silent data loss
- All rule decisions read from Rules.* functions, never DOM — easy to audit and extend

**Testing limitations** (noted in REVIEW-REQUEST, require manual browser test):
- Sanity script uses jsdom (no full page DOM boot, no live click handlers)
- Very old format (talents[] flat array) migration not tested in sanity, only reviewed static (maintains legacy logic)
- Does not exercise click-through of builder UI, acquisition bar, free-pick selects, budget overflow messages in live browser

---

## Cleared

Phase 3 Step 4 complete: character builder wired to structured rules engine (Rules.* functions, never DOM), illegal picks blocked with clear messages (enforcement wrappers call prereq/budget checks), saved characters migrated to id-based shape non-destructively (unresolvable items kept, flagged, never dropped), migration idempotent (re-run safe), reader render path untouched (only shared surface: two script tags + one CSS rule), Definition of Done met, brief adherence complete. Ready for Architect's manual browser testing and merge.
