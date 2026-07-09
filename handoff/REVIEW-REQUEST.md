# Review Request — Cloud Phase 2: mesa/campanha UI
*Written by Bob. Read by Richard.*

Ready for Review: YES

---

## What Was Built

The GM-side and player-side UI for Phase 2 (mesa/campanha), on top of the core Arch already shipped
on this branch (`firestore.rules`, `src/cloud.js` — `createTable`/`getTable` + the
`cloud-my-tables`/`cloud-table-chars` watchers, `src/types.js` typedefs). **This step touched only
`app.js` and `style.css`** — `src/cloud.js` and `firestore.rules` are untouched (confirmed via `git
diff --stat`, only `app.js`/`style.css` show under my changes).

Two pieces:
1. **Player side** — a "Compartilhar com mesa" bar on the char sheet (only when signed in): create a
   table (get a code back) and expose the active character to a table by code, with a remove per
   table.
2. **GM side** — `#mesa` (a new nav link "🏰 Minha mesa", shown only when signed in): per table the GM
   created, the characters exposed to it as compact rows, click to expand a read-only sheet.

Everything is inert when signed out — no share controls render, `#mesa` shows a sign-in prompt, the
sidebar link stays hidden.

## Files changed

### `app.js`
| Lines | What |
|---|---|
| 1305–1313 | `cloudMyTables`/`cloudTableChars`/`expandedMesaChars` — module-level cache + view-state for the GM view. |
| 1348–1377 | `setupCloud()` extended: on `cloud-auth` also calls `updateTableLinkVisibility()` and re-renders `#mesa` if that's the current hash; two new listeners for `cloud-my-tables`/`cloud-table-chars` that update the cache and re-render `#mesa` only when `location.hash === '#mesa'`. |
| 1378–1383 | `updateTableLinkVisibility()` — shows/hides `#toc-mesa-link` per `Cloud.isSignedIn()`. |
| 1414–1465 | `deriveSharedTo`, `exposeCharToTable`, `unexposeCharFromTable`, `buildShareBar` — the expose/unexpose data-model handling (see below) + the share-bar UI. |
| 2795 | `renderCharacter()` — one line, appends `buildShareBar(active)` right after `normalizeCharView`. |
| 2901–3105 (new block after `finishCharRender`) | `renderMyTable()`, `finishMesaRender()`, `renderSharedCharacterReadonly(char)`, `renderReadonlySpherePanel(char, title)` — the `#mesa` view. |
| 3211–3252 | New handlers in `setupCharacter`'s existing delegated click listener: `.char-share-create`, `.char-share-add`, `.char-share-remove`. |
| 3418–3427 | New handler: `.mesa-char-row` click → toggle `expandedMesaChars` → `renderMyTable()`. |
| 4467, 4470 | `navigate()` — `#mesa` added to the special-hash list → `renderMyTable()`. |
| 4515 | `handleInternalLinkClick()` — `#mesa` added to the synthetic-page href list. |
| 4581–4590 | `buildSidebar()` — new `#toc-mesa-link` ("🏰 Minha mesa"), `display:none` by default. |

### `style.css`
- `.char-share*` (share bar) inserted after the `.char-account` block — reuses the `.acc-signin`
  button look and the `.char-sphere-remove` outline-button pattern for chips.
- `.mesa-*` (table/row/detail) inserted after the `.char-build` mobile media query — reuses
  `.char-sphere-collapsed`'s row treatment for `.mesa-char-row`, and `.char-rail-stats`/`.char-sphere`/
  `.char-cards` wholesale for the read-only sheet body.

## Expose/unexpose data-model handling

No dedicated Cloud method exists for this (by design, per the brief) — it's a normal owner write:

```js
function deriveSharedTo(sharedTables) {
  return [...new Set((sharedTables || []).map(t => t.gmUid))];
}
async function exposeCharToTable(active, code) {
  const t = await window.Cloud.getTable(code);          // validates the code is a real table
  if (!t) return { ok: false, message: 'Código de mesa inválido.' };
  const tables = active.sharedTables || [];
  if (tables.some(x => x.code === t.code)) return { ok: true };   // already exposed → no-op
  const sharedTables = tables.concat([{ code: t.code, name: t.name, gmUid: t.gmUid }]);
  updateCharacter(active.id, { sharedTables, sharedTo: deriveSharedTo(sharedTables) });
  return { ok: true };
}
function unexposeCharFromTable(active, code) {
  const sharedTables = (active.sharedTables || []).filter(t => t.code !== code);
  updateCharacter(active.id, { sharedTables, sharedTo: deriveSharedTo(sharedTables) });
}
```

`sharedTo` is **never** written independently — it's always recomputed from `sharedTables` in the
same `updateCharacter` call, so it can't drift. `updateCharacter` is the existing function (unchanged)
that sets `updatedAt` and calls `cloudPush` → `window.Cloud.pushCharacter`, so this rides the existing
sync path; the Firestore rule (`resource.data.ownerUid == request.auth.uid`) already restricts writes
to the owner regardless.

On the GM side, `renderSharedCharacterReadonly(char)`/`renderReadonlySpherePanel` never call
`getActiveChar()` or any mutator — they only read the `char` object handed to them (which for the GM
comes straight off the `cloud-table-chars` event, never `localStorage`). Extras reuse
`charTalentCard(fr, id, 'extra', title)` for the card DOM, then strip the resulting `.char-talent-remove`
button from the clone before it's appended, so no edit affordance reaches the GM's DOM and no core
helper needed a new "readonly" kind.

## Verification done

- `npm run typecheck` — green.
- `npm test` — 35/35 (unchanged, rules layer untouched).
- `node scripts/sanity-builder.js` — 29/29 (unchanged).
- `node --check app.js` — clean.
- **New ad hoc jsdom smoke script** (same technique as `scripts/sanity-builder.js`, not committed —
  lived in the scratchpad during the session, deleted after): loads the real `app.js`/`src/rules.js`,
  stubs `window.Cloud` (no live Firebase — `isSignedIn`/`getTable`/`createTable`/`user`), and drives
  27 assertions:
  - Signed out: no `.char-share-create`/`-add` render, `buildShareBar` returns an empty node, `#mesa`
    shows the sign-in guard message with no `.mesa-table`.
  - Signed in: `exposeCharToTable` with an unknown code → `{ok:false, message}`, no state change;
    with a valid code → chip renders, `sharedTables`/`sharedTo` persisted (verified via
    `getCharacters()`, i.e. `updateCharacter` actually ran); exposing the same table twice is a no-op;
    two tables under the same GM still dedupe `sharedTo` to 1 uid; unexpose removes just that entry
    and recomputes `sharedTo`.
  - The **real click** flow (not just the underlying functions): stubbed `window.prompt`, clicked
    `.char-share-add`/`.char-share-create` for real, confirmed the click handler calls
    `Cloud.getTable`/`Cloud.createTable` and the created-table code shows in a `showCharNotice` toast.
  - `#mesa` populated from injected `cloud-my-tables`/`cloud-table-chars` events: table name+code
    render, exposed character renders as a compact row with `characterStats`-derived CD; clicking
    expands `renderSharedCharacterReadonly` (shows the sphere, a base talent AND an extra talent,
    confirms **zero** `.char-btn`/`.char-sphere-manage`/`.char-talent-remove`/`.char-sphere-remove`
    anywhere in the sheet, confirms rendering another user's character touched no `localStorage`
    character); clicking again collapses it.
  - `updateTableLinkVisibility()` flips the sidebar link's `display` both ways.

**Not tested (needs a live browser + 2 real Google accounts)** — see checklist below.

## 2-Google-account browser click-through (Owner)

Needs `window.FIREBASE_CONFIG` pointed at a real (or emulator) project, and two different Google
accounts — call them **Player** and **GM**.

1. **Player**, signed out: open the app → "Meu personagem" → confirm there is no "Compartilhar com
   mesa" bar, and the sidebar has no "Minha mesa" link.
2. **Player**: sign in with Google → the share bar appears with "Criar mesa" and "Compartilhar por
   código". Create (or have the character already have) an active character.
3. **GM**, a different browser/profile, signed in with the other Google account → sidebar shows
   "🏰 Minha mesa" → click it → "#mesa" → click "Criar mesa" isn't there (that lives on the Player's
   char sheet under the account bar) — instead on the GM's own char sheet, click "Criar mesa", give it
   a name, note the returned **code**. Confirm the table now shows under "Minha mesa" with 0 characters.
4. **Player**: click "Compartilhar por código", paste the GM's code → confirm a chip
   `<table name> <code> ✕` appears under the share bar.
5. **GM**: on "Minha mesa" (may need a refresh, though the watcher should update live), confirm the
   Player's character now appears as a compact row under that table (name · class/subclass · level ·
   CD/PM/Attack). Click the row → confirm it expands into a read-only sheet (stats + spheres/talents)
   with **no** +/✕ buttons, no "adicionar esfera", nothing clickable that mutates. Click again to
   collapse.
6. **Player**: change something on the character (e.g. add a talent, level up) → confirm the GM's
   expanded/collapsed row updates live (no manual refresh) — this is the core "ao vivo" promise of
   Phase 2.
7. **Player**: click the chip's ✕ to unexpose → confirm the character disappears from the GM's table
   view live.
8. **GM**: try creating a table, then have a **third**, uninvolved account attempt to read
   `/tables/{code}` or another GM's `/characters/{id}` directly (via the Firestore console query, not
   the app) to sanity-check the rules Arch wrote are actually enforced server-side — this is Arch's
   surface, but worth confirming end-to-end once real accounts exist.
9. Confirm the pre-existing paths are unaffected throughout: signed-out builder stays fully local, the
   static reader (any `#pN` chapter, glossário, favoritos) works exactly as before.

## Open questions / notes for Arch/Richard

- `renderMyTable()` does a full re-render on every row expand/collapse (not an incremental patch like
  the talent bench's `refreshCharBench`) — chose simplicity given the GM's table/character counts are
  expected to be small. Flag if a patch-based approach is wanted for consistency.
- Used `prompt()`/the existing `showCharNotice()` toast for "nome da mesa"/"código da mesa" and the
  created-code readout — no modal component exists yet in the codebase; `confirm()` is already used
  the same way for character deletion, so this stays consistent with existing UX.
- The `cloud-my-tables`/`cloud-table-chars` listeners re-render gated on `location.hash === '#mesa'`
  rather than the pre-existing `currentChapterIndex === -1` sentinel used by `cloud-auth`/`cloud-chars`
  — that sentinel is shared by all four synthetic views and would otherwise yank a GM looking at
  Favoritos over to `#mesa` on an unrelated cloud event. Left the pre-existing imprecision as-is
  (out of scope for this step) but didn't copy it into the new listeners.
