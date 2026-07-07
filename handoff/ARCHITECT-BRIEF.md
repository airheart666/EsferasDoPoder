# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Layout B (Bancada) — reestruturar a ficha "Meu Personagem"

**Goal:** trocar o layout de `renderCharacter` (app.js:1726) pelo **Layout B / Bancada**, aprovado
pelo Owner num protótipo interativo. Referência visual e de interação: **`design-previews/builder-bancada.html`**
(abra e clique — é o contrato de comportamento). NÃO é uma reescrita da lógica: é UI que REUSA a
camada de enforcement do P3. **Nenhuma regra nova. Nenhuma mudança em `src/rules.js`.**

O que o Layout B é: **rail fixo à esquerda** (identidade + valores + orçamento + navegação de
esferas, sempre visível) e **à direita** o build da esfera ativa + uma **bancada master-detail**
sempre na tela (lista de talentos → detalhe com descrição/custo/pré-requisito → botão Adicionar).
Sem overlay/modal. Adicionar esfera acontece na mesma bancada (modo "esferas").

### Estado de view novo (module-level, NÃO persistir no localStorage)
```js
let charView = { sphere: null, benchMode: 'talents', sel: null, scope: 'sphere', search: '' };
```
Sobrevive aos re-renders (não é reconstruído). Normalizar quando trocar de personagem, ou quando
`sphere` não existir mais nas esferas do ativo: `sphere = 1ª esfera (adquirida ou concedida) do
ativo`, `benchMode='talents'`, `sel=null`, `search=''`. É o `STATE` do mockup portado.

### O que já existe — REUSAR, não reconstruir (assinaturas NÃO mudam)
- **Valores/orçamento**: `characterStats`→`Rules.derivedStats` (1570), `Rules.slotsSpent`,
  `Rules.talentBudget`, `traditionBonus`/`classFeatureBonus` — já computados no `renderCharacter`
  atual (1807-1855). Reaproveitar; só apresentar como mini-grid + barra.
- **Modelo da esfera**: `getSphereModel(title,pkg)` (1531) → `{bases,freeGroup,extras,roleByKey,frag}`;
  `resolveSpec` (1484); `sphereEntry` (1335); `isGrantedSphere` (1326)/`isGrantedTalentId` (1328);
  `grantedSpheresMap` (1312).
- **Cards de talento na ficha**: `charTalentCard(fr, ref, kind, title)` (definido dentro do
  `renderCharacter` atual, ~1891) — clona o card completo, recolhível, com `✕` nos extras. Reusar.
- **Painel pacote+grátis (P1/P2)**: `buildPackageSelector` (696), `buildFreePickSelectors` (718),
  `applyFreePickSelection` (751). O container da esfera DEVE manter a classe `.char-sphere` e o
  bloco `.char-sphere-manage` para os handlers delegados de `.pkg-select`/`.freepick-select`
  continuarem funcionando (eles têm guard `.closest('.char-sphere')`).
- **Botão Adicionar da bancada** = `makeCharControl(item, role, active, entry, false, granted)` (613)
  → devolve um `.char-btn` já com estado +/✓/grátis correto. Assim o handler `.char-btn` dentro de
  `.char-sphere` em `setupCharacter` (2193-2201) roteia por `applyTalentToggle` (892) —
  enforcement idêntico, zero regra nova. Só estilize maior.
- **Candidatos de talento**: mesma conta do `buildAddTalentPicker` (1657):
  `model.freeGroup.concat(model.extras)` − já possuídos (`freePicks`+`talents`) − `isGrantedTalentId`.
  Escopo 'all' = união dessa conta sobre todas as esferas do ativo. Extraia num helper se ajudar.
- **Candidatos de esfera**: mesma conta do `buildAddSpherePicker` (1687) — esferas não possuídas/
  concedidas, agrupadas magia (`section==='magic'`)/poder. Extraia a lista (hoje ela devolve `<select>`).
- **Gate só-de-exibição** (motivo do bloqueio na lista/detalhe): `Rules.canAddTalent` (extras),
  `Rules.prereqCheck` (frees), `Rules.canAccessSphere` (esferas). LER apenas — a mutação real
  segue pelos wrappers (`applyTalentToggle`/`tryAcquireSphere`).
- **Mutadores** (chamar, nunca mutar estado direto): `tryAcquireSphere` (1369), `setPackage` (1390),
  `applyFreePickSelection`, `applyTalentToggle`, `toggleExtraTalent` (1436), `removeSphere` (1383).
- **Descrição de esfera** (detalhe modo-esferas): `cardDescription`/`descriptions.json`.

### Estrutura de DOM (em `renderCharacter`)
`.char-layout` = grid 2 colunas (rail 270px + main); colapsa p/ 1 coluna no mobile.
1. **`.char-rail`** (sticky, `max-height:100vh; overflow:auto`): tabs `.char-selector`/`.charsel-tab`
   + `#char-new` (reusar) · `.char-form` de identidade (MOVER pra cá, campos e handlers `.char-field`
   inalterados) · proficiências (`buildProficiencies`) dentro de um `<details>` recolhível ·
   mini-grid de stats + **`.char-budget-bar`** (largura = usados/orçamento; classe `.over` +
   aviso quando estoura) · **`.char-railnav`**: um `.char-rail-sphere` (dataset.sphere=title) por
   esfera (união `spheres[]`+`grantedMap` keys), selo "concedida" p/ granted, ativo destacado; +
   rodapé `.char-rail-addsphere`.
2. **`.char-build`** (main, topo): só a esfera ativa → extraia o corpo do loop per-sphere atual
   (1938-2013) para `renderSphereBuildPanel(active, title)` (cabeçalho + `.char-sphere-manage` +
   "Incluído com a esfera" + "Talentos" + "Remover esfera"). Mantém `.char-sphere`.
3. **`.char-bench`** (main, baixo): master-detail.
   - modo talentos: busca `.char-bench-search` + chips `.char-bench-scope` (esfera/Todas); lista
     `.char-bench-li` (nome + "1 slot" ou 🔒 bloqueado); detalhe `.char-bench-detail` do `sel`
     (descrição clonada via `findCardInFrag`, custo, linha de gate, botão Adicionar=`.char-btn`).
   - modo esferas: lista de esferas não adquiridas; detalhe = descrição + custo de acesso + gate +
     botão Adquirir → `tryAcquireSphere`.

### Re-render em dois níveis
- **Mutações** (add/remove talento, adquirir/remover esfera, pacote, grátis, `.char-field`) →
  `renderCharacter()` completo (já é o padrão).
- **Só-view** (selecionar item, escopo, busca, trocar esfera ativa) → **`refreshCharBench()`** nova:
  substitui só o subtree `.char-bench` + atualiza a classe ativa do rail (precedente: `refreshSphereUI`
  faz patch dirigido). Preserva foco/cursor da busca (re-focar após patch).

### Wiring (estender o listener delegado em `setupCharacter`, 2132 — NÃO criar listeners novos)
Novos: `.char-rail-sphere` (troca esfera), `.char-rail-addsphere` (benchMode='spheres'),
`.char-bench-li` (sel → refreshCharBench), `.char-bench-scope`, `.char-bench-search` (input →
refreshCharBench + re-focus), e o Adquirir do modo-esferas (reusar `.char-add-sphere-btn` lendo
`charView.sel`, ou novo `.char-bench-acquire`). **Reusar sem tocar**: `.char-btn` em `.char-sphere`,
`.char-talent-remove`, `.char-sphere-remove`, `.pkg-select`/`.freepick-select` (guards `.char-sphere`),
`.char-field`, `.charsel-tab`, `#char-new`, `#char-delete`, `.prof-chip`. **NÃO** alterar os guards
`.closest('.char-sphere')` em `setupFavorites`.

### CSS (`style.css`, junto do bloco `.char-*`)
Novas classes de LAYOUT: `.char-layout`, `.char-rail`, `.char-railnav`/`.char-rail-sphere`/
`.char-rail-addsphere`, `.char-build`, `.char-bench`/`.char-bench-list`/`.char-bench-detail`/
`.char-bench-li`, `.char-budget-bar` + colapso responsivo. Espelhar o mockup. REUSAR sem duplicar:
`.char-stats`, `.char-sphere`/`.char-cards`, `.char-btn`, `.char-sphere-manage`, `.pkg-select`,
`.freepick-select`, `.char-talent-remove`, `.char-granted-badge`, `.char-selector`/`.charsel-tab`.

### Flags (não adivinhe — pergunte ao Arch)
- Só `app.js` e `style.css`. NÃO tocar `src/rules.js`, `parser.js`, `content/*.txt`, render do leitor,
  nem assinaturas dos helpers compartilhados.
- Barra de aquisição da leitura (`renderSphereAcquireBar`) tem de ficar IDÊNTICA.
- Não regredir P1 (free-pick de esfera concedida na ficha) nem P2 (pacote Universal na ficha).
- `charView` NÃO vai pro localStorage.
- Manter `npm run validate`/`typecheck`/`test`/`sanity-builder` verdes (app.js fora do typecheck).
  O gate real é o teste do Owner no browser — escreva o checklist de cliques no REVIEW-REQUEST.

### Definition of Done
- [ ] Ficha renderiza no Layout B: rail (identidade+stats+orçamento+nav) + build da esfera ativa +
      bancada master-detail. Colapsa no mobile.
- [ ] Trocar esfera pelo rail; selecionar talento → detalhe com descrição/custo/pré-req; Adicionar
      com o orçamento (barra) subindo ao vivo; remover (✕) baixando.
- [ ] Pré-req que destrava ao adquirir a dependência; pick bloqueado (nível/orçamento) mostra motivo
      e NÃO muta; estouro de orçamento → barra `.over` + aviso.
- [ ] Escopo esfera/Todas + busca; adicionar esfera pela bancada (modo esferas); trocar de personagem.
- [ ] P1 (Mente concedida oferece free-pick na ficha) e P2 (pacote Universal na ficha) intactos.
- [ ] Barra de aquisição da leitura idêntica.
- [ ] `validate`/`typecheck`/`test`/`sanity-builder` verdes.
- [ ] `handoff/REVIEW-REQUEST.md`: arquivos mudados, a estratégia de re-render em dois níveis, o
      wiring, e o checklist de cliques (com dados reais) para o Owner.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*
