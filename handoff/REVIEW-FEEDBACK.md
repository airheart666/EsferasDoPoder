# Review Feedback — Cloud Phase 2: mesa/campanha (GM + Player UI)

*Written by Reviewer (Richard). Read by Owner and team.*

**Date:** 2026-07-09  
**Verdict:** ✅ **SHIP** — Security rules are sound; data model is correct; no Must Fix issues.

---

## Executive Summary

Phase 2 security rules (character sharedTo array + tables collection) are properly designed and prevent cross-GM/cross-player access. The expose/unexpose data model correctly derives `sharedTo` from `sharedTables` on every write (never stale). Read-only GM render has no edit affordances and never calls mutators. All guards prevent regression (signed-out state, unrelated cloud events). Static checks passing (typecheck, tests 35/35, sanity 29/29). **Not runtime-tested** (needs live browser + 2 Firebase accounts per checklist item 8) — but security review via rules inspection is the main safety gate, and it is sound.

---

## 1. SECURITY — `firestore.rules` (PHASE 2 ADDITIONS) ✅ SAFE TO DEPLOY

**Status: PASS — Character sharedTo is read-only for GMs; tables restrict GMship.**

### New Rules Analysis:

#### Characters Collection (line 12):
```
allow read: if request.auth != null && (resource.data.ownerUid == request.auth.uid || (('sharedTo' in resource.data) && request.auth.uid in resource.data.sharedTo));
```

**Adversarial Test Cases:**

| Scenario | Analysis | Result |
|---|---|---|
| **Character NOT shared to me (my uid not in sharedTo, not owner)** | (ownerUid != uid) AND (('sharedTo' in data) AND uid NOT in sharedTo) = false AND (true AND false) = false | ✅ **Denied** |
| **Character shared to me (my uid in sharedTo)** | (false) OR (true AND true) = true | ✅ **Allowed** (read-only) |
| **Character missing sharedTo field entirely** | (false) OR (('sharedTo' in data) AND ...) = false OR (false AND ...) = false | ✅ **Denied** (existence guard prevents error) |
| **I'm the owner** | (ownerUid == uid) OR (...) = true OR (...) = true | ✅ **Allowed** (full access) |
| **Unauthenticated user** | `request.auth != null` is false for entire rule | ✅ **Denied** |

**Conclusion:** The `('sharedTo' in resource.data)` existence guard correctly prevents both error-as-deny and accidental allow. If sharedTo is missing, the second OR short-circuits to false. If sharedTo exists but is an empty array, `uid in []` is false. **Write access (lines 13–15) still require ownership — a GM in sharedTo is read-only.**

#### Write Restrictions (lines 13–15):
```
allow create: if request.auth != null && request.resource.data.ownerUid == request.auth.uid;
allow update: if request.auth != null && resource.data.ownerUid == request.auth.uid && request.resource.data.ownerUid == request.auth.uid;
allow delete: if request.auth != null && resource.data.ownerUid == request.auth.uid;
```

| Attack | Check | Result |
|---|---|---|
| **GM tries to update Player's character** | resource.data.ownerUid (Player) != request.auth.uid (GM) | ✅ **Denied** |
| **Player tries to grant themselves to another's character** | Can only edit their own; updating sharedTo requires ownership | ✅ **Denied** |
| **Player tries to transfer char to GM** | `request.resource.data.ownerUid` must remain Player's uid (immutable) | ✅ **Denied** |

**Conclusion:** The dual ownerUid check (existing + new) makes ownership immutable. No player, no GM can bypass this.

#### Tables Collection (lines 18–23):
```
allow get: if request.auth != null;
allow list: if request.auth != null && resource.data.gmUid == request.auth.uid;
allow create: if request.auth != null && request.resource.data.gmUid == request.auth.uid;
allow update, delete: if request.auth != null && resource.data.gmUid == request.auth.uid;
```

| Scenario | Analysis | Result |
|---|---|---|
| **`get` a table by code (player joining)** | Any authed user can read the table doc by ID | ✅ **Allowed** (intentional: code is the key) |
| **`get` leaks table name/gmUid** | Yes, but only to someone who knows the code already | ✅ **Acceptable** (code is the credential) |
| **`list` all tables (enumerate)** | `resource.data.gmUid == request.auth.uid` filters to own tables only | ✅ **Denied for others** |
| **Player creates a table** | Must set `gmUid` to their own uid; rule enforces this on server | ✅ **Prevented** (non-GMs can't spoof gmUid) |
| **Unauthorized delete of another's table** | `gmUid != attacker.uid` | ✅ **Denied** |

**Conclusion:** The `get` rule is intentionally permissive (needed for join-by-code), but the `list` rule locks down enumeration. The `create` rule prevents spoofing another GM's uid.

#### Catch-All (lines 25–27):
```
allow read, write: if false;
```
✅ **Correct:** Denies all other paths (e.g., `/users`, `/metadata`).

### Key Security Properties:

1. ✅ **Player's character invisible to uninvited GMs** — sharedTo check prevents reads.
2. ✅ **GM is read-only** — write rules still require ownership.
3. ✅ **Character list for GM is efficient** — query `where('sharedTo', 'array-contains', uid)` + rule check = secure + performant.
4. ✅ **Table access is credential-based** — `get` by code is safe; `list` requires ownership.
5. ✅ **No privilege escalation** — Player can't become GM, Player can't update their own `ownerUid` or others' `sharedTo`.

---

## 2. DATA MODEL — `expose`/`unexpose` (app.js lines 1414–1457) ✅ CORRECT

**Status: PASS — sharedTo always derived; no stale data possible.**

### Function Analysis:

#### `deriveSharedTo(sharedTables)` (line 1418–1420):
```javascript
function deriveSharedTo(sharedTables) {
  return [...new Set((sharedTables || []).map(t => t.gmUid))];
}
```

**Properties:**
- Deduplicates gmUids (Set removes duplicates)
- Handles null/undefined sharedTables (returns [])
- Always produces a clean array of unique GMs

**Test: Player has char in 2 tables of same GM:**
```
sharedTables: [
  {code: 'T1', gmUid: 'GM1', name: 'Table A'},
  {code: 'T2', gmUid: 'GM1', name: 'Table B'}
]
deriveSharedTo() → ['GM1']  ✅ Correct dedupe
```

#### `exposeCharToTable(active, code)` (line 1423–1433):
```javascript
const sharedTables = tables.concat([{ code: t.code, name: t.name, gmUid: t.gmUid }]);
updateCharacter(active.id, { sharedTables, sharedTo: deriveSharedTo(sharedTables) });
```

**Verification:**
- ✅ Validates code exists via `Cloud.getTable()` (trusts no user input)
- ✅ Checks already exposed (no-op if code already in sharedTables)
- ✅ **Both** `sharedTables` and `sharedTo` passed to `updateCharacter` in same call
- ✅ `updateCharacter()` uses `Object.assign(c, patch)` (merges both fields)
- ✅ `updateCharacter()` calls `cloudPush(c)` (single Firestore write)

**Conclusion:** No window between write and push; both fields sync atomically.

#### `unexposeCharFromTable(active, code)` (line 1434–1437):
```javascript
const sharedTables = (active.sharedTables || []).filter(t => t.code !== code);
updateCharacter(active.id, { sharedTables, sharedTo: deriveSharedTo(sharedTables) });
```

**Test: Player unexposes from 1 of 2 tables (same GM):**
```
Before:
  sharedTables: [{code: 'T1', gmUid: 'GM1'}, {code: 'T2', gmUid: 'GM1'}]
  sharedTo: ['GM1']

unexpose from T1:
  filter(t => t.code !== 'T1') → [{code: 'T2', gmUid: 'GM1'}]
  deriveSharedTo() → ['GM1']  ✅ GM1 still has read access via T2
  
Result: GM1 keeps read (correct per requirement)
```

**Test: Player unexposes from all tables:**
```
Before:
  sharedTables: [{code: 'T1', gmUid: 'GM1'}]
  sharedTo: ['GM1']

unexpose from T1:
  filter(t => t.code !== 'T1') → []
  deriveSharedTo([]) → []  ✅ Character hidden from all GMs
```

**Conclusion:** The re-derivation on every unexpose is correct. No stale `sharedTo`. ✅

---

## 3. READ-ONLY GM RENDER — `renderSharedCharacterReadonly()` ✅ SAFE

**Status: PASS — Character never mutated; no edit controls reach DOM.**

### Code Inspection (app.js lines 3001–3105):

```javascript
function renderSharedCharacterReadonly(char) {
  const wrap = document.createElement('div');
  // ... reads char.name, char.className, char.level, etc.
  // NEVER calls getActiveChar()
  // NEVER calls updateCharacter()
  
  // Reuses helper functions (READ-ONLY):
  buildCharBudgetHTML(char)        // ✅ No mutations
  charSphereTitles(char)           // ✅ No mutations
  renderReadonlySpherePanel(char, title)  // ✅ See below
```

### `renderReadonlySpherePanel()` Detail (app.js lines 3050–3105):

```javascript
if (extras.length) {
  const box = document.createElement('div'); box.className = 'char-cards';
  for (const id of extras) {
    const card = charTalentCard(fr, id, 'extra', title);
    card.querySelector('.char-talent-remove')?.remove();  // ← CRITICAL: strip button
    box.appendChild(card);
  }
  group.appendChild(box);
}
```

**Security Properties:**
- ✅ `charTalentCard()` is a reused helper (creates card DOM)
- ✅ The `.char-talent-remove` button is **removed before appending** (not present in final DOM)
- ✅ No event listeners on the card (charTalentCard doesn't add click handlers that mutate state)
- ✅ Character object is **never accessible via localStorage** (comes from `cloud-table-chars` event, not `getCharacters()`)
- ✅ Smoke test confirmed: "zero `.char-btn`/`.char-sphere-manage`/`.char-talent-remove`/`.char-sphere-remove` anywhere in the sheet"

**Potential Risk — Reusing `charTalentCard`:**

The app chose to reuse `charTalentCard()` and strip the button, rather than create a separate `charTalentCardReadonly()`. This is a valid choice **if and only if**:
1. `charTalentCard()` doesn't add event listeners to the card itself (✅ verified: it's DOM generation only)
2. The button removal succeeds (✅ verified: uses optional chaining `?.remove()`)
3. No other edit affordances leak into the card (✅ verified by smoke test)

**Conclusion:** Safe to proceed.

---

## 4. NO REGRESSION — Guards & Unrelated Paths ✅ CORRECT

**Status: PASS — Signed-out state, unrelated cloud events, pre-existing paths unaffected.**

### Signed-Out State (app.js lines 1378–1383):

```javascript
function updateTableLinkVisibility() {
  const link = document.getElementById('toc-mesa-link');
  if (link) link.style.display = (window.Cloud && window.Cloud.isSignedIn && window.Cloud.isSignedIn()) ? '' : 'none';
}
```

**Verification:**
- ✅ Share bar (`buildShareBar`) returns empty div if not signed in
- ✅ Mesa link hidden if not signed in
- ✅ If user directly navigates to `#mesa` while signed out, `renderMyTable()` shows sign-in message (line 2920)

### Cloud Event Listeners (app.js lines 1364–1376):

```javascript
window.addEventListener('cloud-my-tables', e => {
  cloudMyTables = (e.detail && e.detail.tables) || [];
  if (location.hash === '#mesa') renderMyTable();  // ← Only re-render on #mesa
});
```

**Design Decision:** Use `location.hash === '#mesa'` instead of shared `currentChapterIndex === -1` sentinel.

**Why:** If a GM is looking at Favoritos (`#favoritos`, which also uses `currentChapterIndex === -1`), a cloud-my-tables event should NOT yank them to `#mesa`. Bob's choice to use specific hash check avoids this.

**Verification:**
- ✅ Listeners update module-level cache regardless (correct: data stays fresh)
- ✅ Re-render only if current view is `#mesa` (correct: no interruption)
- ✅ When user navigates TO `#mesa`, `renderMyTable()` is called (line 4470), which re-renders with latest cache

### Logout Flow (app.js line 1349 + src/cloud.js line 65):

```javascript
// app.js:
if (!(e.detail && e.detail.user)) { 
  cloudMigrated = false; 
  cloudLastError = null; 
  cloudMyTables = [];      // ← Clear
  cloudTableChars = [];    // ← Clear
}

// src/cloud.js:
if (u) { startSync(u.uid); startTableSync(u.uid); } 
else { stopSync(); stopTableSync(); }  // ← Unsubscribe
```

**Verification:**
- ✅ Tables and characters cache cleared on logout
- ✅ Table sync listeners unsubscribed on logout
- ✅ If on `#mesa` during logout, `renderMyTable()` re-renders and shows sign-in message

### Pre-Existing Paths (chapters, glossary, favorites):

**No changes to:**
- `renderGlossary()` (line 4125+)
- `renderFavorites()` (line 4093+)
- Chapter rendering (via `navigate()`)

**Verification:**
- ✅ Pre-existing event handlers unchanged
- ✅ Cloud events only re-render if `location.hash === '#mesa'`
- ✅ Reader (static chapters) never calls `ensureCloud()` (no SDK loaded)

**Conclusion:** Regression prevention is sound. ✅

---

## 5. STATIC CHECKS ✅ ALL PASSING

| Check | Command | Result |
|---|---|---|
| Syntax | `node --check app.js src/cloud.js src/types.js` | ✅ PASS |
| TypeScript | `npm run typecheck` | ✅ PASS |
| Tests | `npm test` | ✅ PASS (35/35, unchanged) |
| Sanity | `npm run sanity-builder.js` | ✅ PASS (29/29, unchanged) |

---

## ISSUES FOUND

### Must-Fix
**None.** ✅

### Should-Fix
**None.** ✅

### Escalate to Architect
**None.** ✅

---

## OPEN ITEMS (Not Blockers — Pre-Deployment)

### Item 8 from Bob's Checklist: Real-Account Firestore Verification

**What:** Bob notes: "try creating a table, then have a **third**, uninvolved account attempt to read `/tables/{code}` or another GM's `/characters/{id}` directly (via the Firestore console query, not the app) to sanity-check the rules Arch wrote are actually enforced server-side."

**Why Required:** Rules inspection is static; runtime enforcement must be verified with real Firebase + accounts.

**Who:** This is Owner's responsibility (before production).

**Test Steps:**
1. Deploy to staging or use Firebase emulator
2. Account A: Create a table (note the code)
3. Account B: Attempt `getDoc(doc(db, 'tables', code))` via console → should succeed (read access is open)
4. Account C (uninvolved): Attempt `getDoc(doc(db, 'tables', code))` via console → should succeed (intentional)
5. Account C: Attempt `getDoc(doc(db, 'characters', charIdNotSharedToC))` via console → should fail with "Missing or insufficient permissions"

**Acceptance Criteria:**
- ✅ Uninvolved user CANNOT read character not shared to them
- ✅ Uninvolved user CANNOT enumerate other GMs' tables
- ✅ Player CANNOT list other players' characters

---

## RECOMMENDATION

**✅ SHIP**

**Prerequisite:** Owner must perform item 8 (real-account Firestore test) before production deploy.

**Risk Level:** LOW
- Security rules are correct (static inspection + architectural soundness)
- Data model prevents stale `sharedTo` (derived on every write)
- Read-only render has no edit affordances (verified by smoke test)
- No regression to existing paths (hash-based re-render guard)
- Static checks all green

**Blockers:** None  
**Should-Fix:** None  
**Nits:** Item 8 verification before production

---

## COMPARISON TO PHASE 1

| Aspect | Phase 1 | Phase 2 |
|---|---|---|
| Security surface | Character ownership | + Character sharedTo + Tables collection |
| Rules complexity | 3 ops × 2 collections = 6 rules | + 4 ops × 1 collection = 6 + 4 = 10 rules |
| Sync risk | LWW merge + migration | Data model (sharedTo derivation) + new listeners |
| Static checks | ✅ Green | ✅ Green (unchanged: 35/35, 29/29) |
| Runtime test | Browser login | Browser login + 2-account GM/Player + real character sharing |

---

**Reviewed by:** Richard  
**Date:** 2026-07-09  
**Confidence:** High (static inspection complete; runtime to be verified by Owner)
