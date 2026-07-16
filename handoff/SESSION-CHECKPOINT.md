# Session Checkpoint — 2026-07-16
*Read this before reading anything else. If it covers current state, skip BUILD-LOG.*

---

## Where We Stopped

Everything is on **`master`** (feature branches merged/deleted). The structured-mechanics layer and the
character builder are complete and live. All checks green:
**validate 0 errors · 0 talents flagged `_needsReview` · typecheck clean · test-rules 81 · sanity-builder 36.**

Recent history (HEAD = `4124e10`):
- `8c0a954` **Tier 2** — enforce flagged prerequisites (new prereq types or/tag/skill/package/martial-talent + curated overrides).
- `7b61421` **Sphere packages Fase 1+2** — multi-package model (`char.spheres[].packages: string[]`; free package + repeatable "grant" talent, +1 slot each) and element/type scoping (element tags → `{type:'package'}` prereq for Natureza/Domínio das Feras; Universal/Alquimia excluded to keep KG-4/KG-5 intact).
- `94e42ac`/`b1c36dd` **Traditions** — "Mestre Generoso" (+3, magic & martial). Root `traditions.json` is the source (extractor copies → `data/`).
- `3afebf0` **Grupo E** — resolved the last 5 flagged dual-sphere talents ("geomancia" = mistranslation of "protomancia" → Natureza packages; "Bomba Cadavérica" → talent Bomba de Cadáver). **Prerequisite/curation layer is 100% resolved (0 flagged).**
- `4124e10` **Builder fixes** — (a) bench talent list keeps its scroll on select; (b) Guardião dedup ("Chamado de Ferro Frio"/"Durável"); (c) **Guardião & Liderança modeled as package spheres** (Desafio/Patrulha; Seguidores/Companheiro) with scopeTags + grant talents, plus the "Parceiro"/"Ajudante"→"Companheiro" translation fix and corrected overrides; (d) **Batedor/Canalha/Ilusão acquisition grants** via a new `acquisition.baseTalents` field (names forced to `kind:base`, for spheres whose bases sit after the first group heading) + proficiency conditionals.

**Cloud (Firebase) — Fase 1 (login Google + sync) AND Fase 2 (mesa/campanha) are live and functional.**
Rules published in the console (Owner-confirmed); `firestore.rules` in the repo matches. See [[cloud-persistence]].

---

## What Was Decided (still governing)

- Vanilla-JS / no-build stack; the reader is 100% static; only the builder uses Node tooling + Firebase.
- Structured data in `data/` is canonical for mechanics; the builder consumes it exclusively; `npm run validate`
  keeps it honest (schema + referential integrity + prose cross-check).
- Editing content = edit the chapter `.txt` in `content/`; editing rules/prereqs/packages/traditions/base
  abilities = edit the authoring roots (`sphere-rules.json`, `prereq-overrides.json`, `traditions.json`) then
  `npm run extract`. New acquisition mechanisms: `packages` (grantTalent + scopeTags) and `baseTalents`.
- Commit/push only on explicit Owner request. Push to `origin/master` deploys GitHub Pages. Data files carry
  recurring LF↔CRLF noise — stage only real changes (JSON content), not the byte-noise siblings.

---

## Still Open (minor; nothing blocking)

- **Nit (low priority):** changing the free package clears free-picks belonging to a still-owned *extra*
  package (Universal edge only). Safe but conservative; flagged in Richard's sphere-packages review.
- **Owner decision:** keep or remove the 4 `card-template/*.pdf` tracked in git.
- **Optional future (never committed to):** Phase 4 (modularize `app.js` into ES modules + expand checkJs),
  Phase 5 (render the reader from structured data instead of the prose pipeline).
- **Watch:** some spheres open with a "Lembretes de Regras de Combate" section, so rules-reminder cards can
  surface as selectable talents and real bases need `acquisition.baseTalents`. Fixed where reported (Batedor/
  Canalha/Ilusão); apply the same treatment if another sphere shows the symptom.

---

## Resume Prompt

You are the Architect on this project. Read CLAUDE.md, then this SESSION-CHECKPOINT.md. Everything is on
`master` and green (validate 0 err / 0 flagged, test-rules 81, sanity 36); the builder, sphere packages
(Fase 1+2), Tier 2 prereqs, Grupo E curation, the martial package spheres, acquisition-grant fixes, and Cloud
Fase 1+2 are all done and live. Confirm state, then ask the Owner what to tackle (see "Still Open"). Commit/
push only when the Owner asks; stage only real JSON changes, not the LF/CRLF byte-noise data files.

---

## Version Check
version_notified: v1.3.0
