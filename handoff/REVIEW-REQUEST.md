# Review Request — Builder: 4 melhorias (login header, ordem sub-cat, detalhe esfera, grátis tipados)
*Written by Architect (implemented inline). Read by Richard.*

Ready for Review: YES

---

## Escopo (branch `builder-subcategories`, off master)

**Ponto 1 — Login no cabeçalho.** Botão `#account-toggle` no `#top-bar` (`index.html`) — deslogado
entra (`cloudSignIn`), logado sai (`Cloud.signOut`); some sem `FIREBASE_CONFIG`. `setupAccountButton`
(app.js) chama `ensureCloud()` no boot → a aba "Minha mesa" passa a aparecer sem visitar a ficha.
Reusa a auth da Fase 1; nenhuma lógica nova de nuvem.

**Ponto 2 — Ordem alfabética DENTRO de cada sub-categoria (builder + leitor).**
- Builder: `getSphereModel` ordena `freeGroup`/`extras` e os itens por grupo via `sortBySubcategory`
  (ordem dos grupos = 1ª aparição no dado; alfabético por nome dentro).
- Leitor: `sortReaderTalentCards` (após `enhanceTalents` em `renderChapter`) reordena **corridas de
  `.talent-card` consecutivos** in-place — nunca cruza h3/h4 de grupo, nunca move `.base-ability`
  nem tabelas. Não altera `content/*.txt` nem ids.

**Ponto 3 — Detalhe de "adicionar esfera" mostra texto inicial + bases + grátis.**
`buildSphereDetail` mostra `sphere.intro` (preâmbulo, novo campo do extractor), talentos-base
(`kind:base`), e as escolhas grátis tipadas concedidas. Fallback p/ a descrição curta se `intro` ausente.

**Ponto 4 — Concessão de grátis TIPADA e múltipla (corrige 7 esferas).** O núcleo sensível.
- Modelo novo `acquisition.freeGroups: [{tags,picks,label}]`. Retrocompatível — `freeGroup`+`freePicks`
  (Destino/Conjuração/Engenhosidade/pacotes) normaliza como 1 grupo. `classSpec` produz `groups[]`;
  `resolveSpec` resolve picks (condicionais → grupo[0]); `talentRole` = free se casa QUALQUER grupo;
  `getSphereModel.freeGroups` = itens por grupo.
- `buildFreePickSelectors` reescrito: 1 seletor por pick POR grupo, filtrado às tags. Mutação virou
  **id-based** (`setFreePick(old,new)`, `applyFreePickSelection(old,new)`) — corrige bug latente
  (freePicks compactado × índice de slot) que multi-grupo exporia. Os 2 handlers lêem `dataset.cur`.
- `freePickRoom` (cota por grupo) gateia o + dos cards e `applyTalentToggle` (2º tipo vira extra, não
  grátis). Dados: `sphere-rules.json` → freeGroups das 7; schema+types; `data/` regenerado.

## Foco da revisão (por risco)
1. **Multi-grupo — não regredir pacotes/condicionais.** Pacote escolhido → 1 grupo; não escolhido →
   nada grátis; condicionais somam no grupo[0]; só-condicional ganha grupo sem filtro (lista inteira,
   como antes). Universal (KG-4/KG-5) e Alquimia corretos.
2. **Mutação id-based.** Trocar/limpar um grátis; sem duplicar; grátis×extra exclusivos.
3. **freePickRoom.** Destruição: 2 talentos de tipo pelo + → 1º grátis, 2º extra (cota do grupo).
4. **Ordem do leitor.** `sortReaderTalentCards` só reordena corridas; não quebra base/tabelas/grupos.
5. **Verde:** validate 0 · typecheck · test 35/35 · sanity-builder **36/36** · `node --check app.js`.

## Verificação feita
validate 0 · typecheck verde · test 35/35 · sanity-builder 36/36 (Destruição=2 grupos tipo/formato;
itens por grupo; Aprimoramento=aprimorar|degradar; Mente filtrado a encanto; Engenhosidade sem
regressão) · app.js parseia. **Não** testado no browser (gate do Owner): os 2 seletores da Destruição,
a ordem no leitor, o detalhe da esfera, o login no header.
