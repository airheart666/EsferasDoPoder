# Review Request — Tier 2: enforcement dos pré-requisitos flagged (tipos novos + overrides)
*Written by Architect (implemented inline). Read by Richard.*

Ready for Review: YES

---

## Escopo (branch `tier2-prereqs`, off master)

Fecha ~17 dos 22 talentos flagged (`_needsReview`) com **enforcement real**; sobra só o grupo E (5,
reservado p/ curadoria manual do Owner). Toca o **prereqCheck** (enforcement central).

**1. Motor (`src/rules.js`) — novos tipos de prereq.** `prereqCheck` (305) agora delega a um avaliador
`prereqEval(p, char, idx, ctx)` que retorna true/false/null:
- `or` `{of:[...]}` → satisfeito se QUALQUER filho (recursivo); null se todos null (nenhum falso definitivo).
- `tag` `{tags:[], count}` → nº de talentos possuídos cujas tags ∩ tags ≥ count.
- `skill` `{skill}` → `char.proficiencies.skills/tools` (normalizado).
- `package` `{sphere, pkg}` → a entrada da esfera escolheu esse pacote.
- `martial-talent` → possui ≥1 talento de esfera `section:'martial'` (pega o Artífice).
- desconhecido → null (unverified — resíduo descritivo, comportamento atual).
- Novo helper local `normalizeTerm` em rules.js (igual ao extractor/app.js) p/ comparar tags.

**2. Dados — `prereq-overrides.json` (raiz, autoral).** Tabela `{nome: [prereqs]}` (nomes talent/sphere
resolvidos→id pelo extractor via `resolveOverridePrereq`, recursivo em `or`). O extractor
(`applyPrereqOverrides`) substitui `prerequisites` e limpa `_needsReview` dos alvos. 15 entradas
(Morte×5 OR, Atletismo OR, Batedor skill, Destino tag motivo/palavra, Alquimia tag×5, Liderança tag,
Manipulação de Energia OR bespoke, Contramágica/Contra-ataque Caótico OR+package, Foco Místico martial).

**3. Rename (fonte `content/22-universal.txt`, 3 linhas):** Contrafeitiço→Contramágica; Contra-magia do
Tolo→Contramágica do Tolo; menção no corpo. Re-extract muda id (`universal-contrafeitico`→
`universal-contramagica`) → **churn de id** em saves (degrada não-destrutivo, como KG-4).

**4. UI (`app.js`):** `describePrereq` (recursivo) renderiza os tipos: "A ou B", "N talento(s) de (tag)",
"proficiência em X", "pacote X", "um talento de esfera marcial". `prereqCheck` já bloqueia.

**5. Schema/types/tests:** `talent.schema.json` (variantes de prerequisite) + check leve de
`prereq-overrides.json` no validate; `src/types.js` Prerequisite. `test-rules.js` +12 asserções (uma por
tipo: OR libera com qualquer alternativa; tag conta certo; skill; package; martial; rename).

## Foco da revisão (por risco)
1. **`prereqEval` — recursão do `or` sem loop e semântica true/false/null correta.** Um `or` com filhos
   todos-null retorna null (não bloqueia); com um filho true retorna true. Não há ciclo (prereqs não
   referenciam a si além do dado; ver Aparição→[Sombra, Aparição] que na prática = "requer Sombra").
2. **Sem regressão nos prereqs simples/existentes** (talent/sphere/level) nem em KG-4 (esfera dupla)/
   pacotes. `prereqCheck` mudou de forma mas mantém missing/unverified.
3. **Overrides aplicam ao alvo certo** (match por nome exato ou `nome (…)`/`nome […]`) — conferir que
   "Contramágica" (renomeado) pegou o override certo e NÃO o "Contramágica do Tolo".
4. **tag/skill/package/martial corretos** contra o dado real (tags normalizadas sem acento; package lê
   choices.pkg; martial lê sphere.section).
5. **Verde:** validate 0 · typecheck · test **47/47** · sanity **36/36** · `node --check app.js` ·
   flagged **22→5** (só grupo E).

## Verificação feita
validate 0 · typecheck verde · test 47/47 (12 novos por tipo) · sanity 36/36 · app.js parseia · flagged
5 (grupo E). **Não** testado no browser (gate do Owner): Múmia libera com Esqueleto/Zumbi; Frasco exige 5
de fórmula/veneno; Batedor exige perícia; Foco Místico exige talento marcial (Artífice); Contramágica
renomeada no leitor+ficha. Grupo E permanece flagged (reservado).
