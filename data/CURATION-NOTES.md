# Curation Notes — remaining flagged prerequisites (Bucket 3 only)

_All talent-name mismatches (Buckets 1 & 2) are resolved:_
- _Sphere self-references fixed at source (Esgrima→Duelismo, Taverna/Bar→Brigão, Berserker→Ímpeto)._
- _Talent-name variants resolved via extractor `TALENT_ALIAS` (auditable in `scripts/extract-structured.js`)._
- _Source renames: Ataque (metaesfera)→Golpe (metasfera), Pomada→Bálsamo, "Tempo"→"Esfera do Tempo"._
- _Formatting fix: "Borda Irregular (frágil)" split into its own talent card (was merged into Escudo Improvisado)._
- _The 2 `pp`-cost typos (Sentido, Aprimorar) fixed to `0 PM`._

## Tier 2 — RESOLVIDO 2026-07-11 (branch `tier2-prereqs`)

O motor ganhou os tipos de pré-requisito **`or` / `tag` / `skill` / `package` / `martial-talent`**
(`src/rules.js` `prereqEval`), e os ~15 casos flagged foram estruturados numa tabela autoral
**`prereq-overrides.json`** (fundida por nome no extractor → resolve talent/sphere→id, limpa
`_needsReview`). Decisões do Owner aplicadas (incl. Condicionamento Intenso corrigido na fonte = só
nível 5; Manipulação de Energia = OR bespoke de Elemental/Gosma/Traços Sobrenaturais; rename
**Contrafeitiço→Contramágica** e Contra-magia do Tolo→Contramágica do Tolo). **Flagged: 22 → 5.**

**Restam 5 (grupo E — reservado p/ curadoria manual do Owner):** os talentos "esfera dupla" com
referência aninhada não resolvida — Aprimoramento de Liga / Telecinese de Liga ("geomancia metálica"),
Chama Luminosa ("geomancia do fogo"), Necromancia Silvestre ("geomancia vegetal"), Explosão Cadavérica
("Bomba Cadavérica"). Ficam como `text` (confirmar manualmente) até a curadoria de E.

---
## (Histórico) Backlog original — Bucket 3

The **17 originally-flagged** were prerequisite **types** the rules engine had to support (now done above).

## Remaining (17)

### OR-alternatives — satisfy if ANY listed talent is owned
- Esqueleto (morto-vivo) **ou** Zumbi (morto-vivo) — Morte
- Sombra (morto-vivo) **ou** Espectro (morto-vivo) — Morte
- Carniçal (morto-vivo) **ou** Zumbi (morto-vivo) — Morte
- Sombra (morto-vivo) **ou** Aparição (morto-vivo) — Morte
- Furtividade **ou** Sobrevivência — Batedor
- Salto com Vara **ou** Balanço de Corda — Atletismo
- Contra-ataque **ou** a capacidade de conjurar dissipar magia — Universal
- Dissipar **ou** pacote de mana — Universal

### Tag/category requirements — N talents carrying a tag
- um talento (motivo) — Destino (×2)
- pelo menos um talento [maldição] (palavra) — Destino
- qualquer combinação de cinco talentos de (fórmula) ou (veneno) — Alquimia

### Package requirements — a sphere acquisition package
- pacote de ajudante — Liderança
- pacotes de seguidores e parceiros — Liderança

### Descriptive — unstructurable, stays manual-confirm text
- qualquer talento que conceda resistência a ácido — Alteração
- radiante ou trovão como opção de traço — Alteração
- habilidade de contra-ataque — Retribuição
- Habilidade para obter foco marcial (veja Esferas de Poder) — Universal

## Rules-engine backlog (Phase 3)
- **OR-group** prereq type: `{ type: 'or', of: [Prerequisite...] }` — satisfied if any child is.
- **Tag requirement** prereq type: `{ type: 'tag', tag, count }` — N owned talents carrying `tag`.
- **Package** prereq type: references a sphere acquisition package.
- **Descriptive**: left as `text`; rules engine reports "confirm manually", never blocks silently.
