# Symmetry Curation — all remaining name mismatches (to fix at source, no aliases)

> **STATUS: APPLIED (2026-07-06).** All items below fixed at source; canonical spelling = `metaesfera`;
> `TALENT_ALIAS`/`SPHERE_ALIAS` deleted. Verified: flag count holds at 18 (Bucket 3) with zero aliases,
> so prose is fully self-sufficient. Guardiã handled as only 4 real `Esfera Guardiã` refs (+2 masculine).

Every mismatch currently masked by an extractor alias. After you curate, all aliases get
deleted and the prose is fixed. Occurrence counts are across all `content/*.txt`
(prereqs AND prose bodies — full symmetry means all of them).

## 1. Talent-name mismatches — prose says → canonical talent

| # | Prose says | → Talent | occ | files |
|---|---|---|---|---|
| T1 | Quebrar a Terra | **Quebra-Terra** | 6 | impeto, luta-livre |
| T2 | Projeção de Pensamentos | **Pensamentos Projetados** | 4 | mente |
| T3 | Imobilização | **Imobilizar** | 5 | luta-livre |
| T4 | Imagem Fraturada | **Imagem Fragmentada** | 3 | tempo |
| T5 | Defender Outros | **Defender Outro** | 1 | guardiao |
| T6 | Forjar Terra | **Forjar a Terra** | 1 | natureza |
| T7 | Teletransporte à Distância | **Teleporte à Distância** | 3 | distorcao |
| T8 | Teletransporte Invisível | **Teleporte Invisível** | 3 | distorcao |
| T9 | Teletransporte de Objeto | **Teletransportar Objeto** | 3 | distorcao |
| T10 | Corpo Retorcido | **Corpo Distorcido** | 2 | alteracao |
| T11 | pacote de companheiros ⚠ | **Pacote de Companheiro**? | 1 | lideranca |

⚠ **T11**: lowercase/plural — confirm it's the "Pacote de Companheiro" talent and not a generic phrase.

## 2. Metasphere talents — entangled with the spelling split (see §4)

| # | Prose says | → Talent | occ | files |
|---|---|---|---|---|
| M1 | Estendida (meta*sfera) | **Estendido (meta?sfera)** | 6 | aprimoramento, alteracao, criacao, morte, natureza, vida |
| M2 | Massa (meta*sfera) / Massa — metasfera | **Em Massa (meta?sfera)** | 27 | aprimoramento, alteracao, distorcao, telecinese, tempo, universal, vida, mente |
| M3 | Alcance (metasfera) [+ "(3)"] | **Alcance (meta?sfera)** | 6 | alteracao, conjuracao, criacao, distorcao, natureza, universal |

Note: M2 ("Massa" → "Em Massa") is the biggest and trickiest — "Massa (metasfera)" is a literal
substring of the real talent "Em Massa (metasfera)", so I'll do it with targeted edits, not a blind
replace. M3's real talent already exists as "Alcance" — only the spelling + a stray "(3)" differ.

## 3. Sphere-name mismatches — prose says → canonical

| # | Prose says | → Sphere | occ | files | note |
|---|---|---|---|---|---|
| S1 | Domínio de Feras | **Domínio das Feras** | 12 | atletismo, dominio-das-feras | missing "as" |
| S2 | Esfera Temporal | **Esfera do Tempo** | 6 | destruicao, tempo | adjectival → confirm phrasing |
| S3 | Esfera Climática | **Esfera do Clima** | 2 | clima | adjectival → confirm phrasing |
| S4 | Guardiã ⚠ | **Guardião** | 21 | capa, morte, protecao, esferas-marciais, guardiao | SEE WARNING |

⚠ **S4 (Guardiã)**: "Guardiã" is also the ordinary **feminine** of "guardião" (e.g. "criatura guardiã",
"esfera guardiã"). Most of the 21 are probably NOT the sphere name. This one needs per-occurrence review —
I'll show you all 21 in context and you mark which are the sphere. Do NOT bulk-replace.

## 4. Book-wide spelling decision: `metasfera` vs `metaesfera`

The source uses **both**, even in talent headings: `metasfera` = 32 occ, `metaesfera` = 44 occ.
- Headings using `metasfera`: Em Massa, Estendido, Golpe.
- Headings using `metaesfera`: Alcance.

**Pick one canonical spelling** and I'll standardize every occurrence (headings + all references),
which also resolves M1/M2/M3 cleanly. (Leaning `metaesfera` since it's the majority — your call.)

---

## Decisions I need from you
1. **Spelling**: `metasfera` or `metaesfera` for the whole book?
2. **S4 Guardiã**: I'll show all 21 in context; you mark which are the sphere. (Or confirm a rule.)
3. **T11**: is "pacote de companheiros" the Pacote de Companheiro talent?
4. **S2/S3 phrasing**: "Esfera do Tempo" / "Esfera do Clima" OK, or different?
5. Anything in §1–§3 that's actually wrong — correct me.

## Not in scope (not name mismatches)
The 18 remaining `_needsReview` flags are Bucket-3 prerequisite **types** (OR-groups, tag/package,
descriptive) — rules-engine features, not name fixes. Listed in `data/CURATION-NOTES.md`.
