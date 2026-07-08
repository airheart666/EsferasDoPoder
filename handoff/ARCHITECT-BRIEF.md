# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## KG-5 — Metamágica: UI da cota restrita (entrada própria no accordion)

**Contexto:** a **camada de regras do KG-5 já está pronta e testada** (Arch). Falta só a UI no
builder (`app.js` + `style.css`). Referência de comportamento aprovada pelo Owner: uma **entrada
própria no accordion de esferas** ("✦ Metamágica — X/N escolhas"), que expande e mostra as
escolhas + um seletor dos talentos metaesfera reusando a **bancada** (mesma leitura master-detail).

**A regra (já implementada — só CONSUMA, não reimplemente):**
- `Rules.restrictedAllowances(active, dataIndex)` → `[{feature, sphere, tag, count, note}]`.
  Para Feiticeiro nível ≥3 devolve `[{feature:'Metamágica', sphere:'Universal', tag:'metaesfera',
  count:N, note}]` (N=2 no 3, +1 no 10, +1 no 17); vazio para quem não tem a feature.
- As escolhas vivem em **`char.metamagic: string[]`** (ids de talento). Custo 0, fora do orçamento
  geral (o motor já não soma o +2). `Rules.ownedTalentIds` já inclui `char.metamagic`.
- **Migração:** em `migrateCharacters`, garanta `char.metamagic = []` quando ausente.

### O que construir

1. **Sentinela de view:** defina `const METAMAGIC_KEY = 'mm:Metamágica';` (module-level). É o valor
   que `charView.sphere` assume quando a entrada Metamágica está expandida. Não colide com título
   de esfera. (Só há UMA allowance hoje; se quiser generalizar, chave por feature — mas escopo = 1.)

2. **Accordion (`buildCharBuildContent`):** depois das esferas, se `restrictedAllowances(active)`
   não for vazio, acrescente a entrada Metamágica:
   - expandida (`charView.sphere === METAMAGIC_KEY`) → `renderMetamagicPanel(active, allowance)`;
   - recolhida → um `.char-sphere-collapsed` com `data-sphere="mm:Metamágica"`, rótulo
     "✦ Metamágica" + `<span class="csc-count">X/N escolha(s)</span>` (X=`char.metamagic.length`,
     N=`allowance.count`). O handler `.char-sphere-collapsed` **já existente** faz `charView.sphere
     = data-sphere` → expande. Reuse-o (não crie handler novo p/ recolhido).

3. **`renderMetamagicPanel(active, allowance)`** — espelha `renderSphereBuildPanel`:
   - container `section.char-sphere`; header `h3.char-sphere-title.char-sphere-toggle`
     `data-sphere="mm:Metamágica"` (o handler `.char-sphere-toggle` já existente recolhe →
     `charView.sphere=null`). Texto: "✦ Metamágica — X/N escolha(s)".
   - a `note` da allowance (`<p class="char-subhead">…</p>` ou similar).
   - cards das escolhas: para cada id em `char.metamagic`, `charTalentCard(model.frag, id, 'free',
     'Universal')` (reuse — clona o card real). O ✕ de remoção NÃO pode usar `.char-talent-remove`
     (aquele chama `toggleExtraTalent`); use um botão próprio `.char-mm-remove` `data-id="<id>"`.
     `model = getSphereModel('Universal', null)` p/ ter o `frag`.
   - se `char.metamagic.length < count`: uma linha guiando "escolha na bancada abaixo".

4. **Bancada em modo Metamágica (`buildTalentBenchPanel`):** quando `charView.sphere ===
   METAMAGIC_KEY`:
   - candidatos = talentos da esfera **Universal** com a tag da allowance (`metaesfera`) que **não**
     estejam em `char.metamagic` **nem** em `Rules.ownedTalentIds(active, dataIndex)` (evita duplicar
     com uma escolha da própria Universal). Fonte: `getSphereModel('Universal', null)` →
     `roleByKey`/talents, ou filtre `dataIndex.sphereById.get('universal').talents` por tag.
   - barra de ferramentas: um rótulo "Metamágica — escolha talentos (Meta) da Universal (X/N)"
     (sem chips de escopo; sem "+ Adicionar esfera").
   - lista `.char-bench-li` (reuse) + detalhe. O detalhe pode reusar a estrutura de `buildTalentDetail`
     (tag/nome/meta/descrição clonada), **mas** o botão de ação é `.char-mm-add` `data-id="<id>"`
     com rótulo "Adicionar (Metamágica)"; desabilitado ("Cota cheia") quando
     `char.metamagic.length >= count`. Considere um `buildMetamagicDetail(active, item, allowance)`
     dedicado para não misturar com o caminho de `applyTalentToggle`.

5. **Dedupe na Universal comum:** em `talentCandidatesForSphere` (usado pela bancada no modo
   talentos), exclua também ids presentes em `char.metamagic` — um talento tomado pela Metamágica
   não deve aparecer como extra comprável na Universal (e vice-versa já vem da regra 4).

6. **Handlers (`setupCharacter`, estenda o listener existente — NÃO crie outro):**
   - `.char-mm-add` → se `char.metamagic.length < count` e a tag confere: `push(id)`,
     `updateCharacter`, `renderCharacter()`; senão `showCharNotice(el, 'Cota de Metamágica cheia (N).')`.
   - `.char-mm-remove` → remove o id de `char.metamagic`, `updateCharacter`, `renderCharacter()`.
   - reutilize os handlers existentes de `.char-sphere-collapsed`, `.char-sphere-toggle`,
     `.char-bench-li` (seleção) — eles já funcionam com o sentinela.

7. **`normalizeCharView`:** trate `METAMAGIC_KEY` como válido quando a allowance existe:
   `const validSphere = charView.sphere === null || titles.includes(charView.sphere) ||
   (charView.sphere === METAMAGIC_KEY && Rules.restrictedAllowances(active, dataIndex).length > 0);`
   (se a feature sumir — ex.: nível cair abaixo de 3 — o sentinela vira inválido e reseta.)

8. **CSS (`style.css`):** mínimo — reuse `.char-sphere`, `.char-sphere-collapsed`, `.char-sphere-toggle`,
   `.char-cards`, `.char-btn`. Só um realce do ✦/entrada Metamágica se precisar. O `.char-mm-add` pode
   reusar o visual de `.char-btn.char-bench-add`.

### Flags (não adivinhe — pergunte ao Arch)
- **Nenhuma mudança em `src/rules.js`** (a regra está pronta) nem em `content/*.txt`/`parser.js`/leitor.
- Não regredir: accordion (esferas), bancada (talentos e esferas), P1/P2, barra de aquisição da leitura.
- Toda escolha passa pelo teto `count` e pela tag; nunca inflar o orçamento geral (a UI só reflete).
- Mantenha `npm run validate`/`typecheck`/`test`/`sanity-builder` verdes (app.js fora do typecheck).
  Gate real = teste do Owner no browser; escreva o checklist de cliques no REVIEW-REQUEST.

### Definition of Done
- [ ] Feiticeiro nível ≥3 mostra a entrada "✦ Metamágica — X/N" no accordion; expande/recolhe como as esferas.
- [ ] Expandida: lista as escolhas atuais (cards + ✕) e, na bancada, os talentos metaesfera para escolher
      (leitura master-detail), com o botão bloqueando ao atingir N.
- [ ] Escolher/remover atualiza X/N ao vivo; o orçamento mágico geral NÃO muda (segue sem o +2).
- [ ] Um talento tomado pela Metamágica não aparece como extra comprável na Universal (dedupe).
- [ ] Personagem sem a feature (ex.: Feiticeiro nível 1, ou outra classe) NÃO mostra a entrada.
- [ ] `validate`/`typecheck`/`test`/`sanity-builder` verdes; `REVIEW-REQUEST.md` com o checklist.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*
