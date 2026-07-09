# Architect Brief
*Written by Architect. Read by Builder and Reviewer.*
*Overwrite this file each step — it is not a log, it is the current active brief.*

---

## Nuvem Fase 2 — Mesa/campanha: UI (o mestre vê os personagens dos jogadores ao vivo)

**Contexto:** o núcleo (regras + `src/cloud.js` + typedefs) **já está pronto** (Arch). Falta a **UI**
(`app.js` + `style.css`). Referência de decisão de UX (aprovada): visão do mestre = **lista compacta
+ expandir** por personagem. Só ativo quando **logado** (Fase 1); deslogado, o builder é local como
hoje. **Não** tocar `src/cloud.js`/`firestore.rules` (Arch os desenhou), nem leitor/parser/conteúdo.

### O que o `window.Cloud` já oferece (CONSUMIR, não criar)
- `window.Cloud.createTable(name)` → `{ ok, code, name }` (cria mesa; `code` é o convite = id).
- `window.Cloud.getTable(code)` → `{ code, name, gmUid, gmName } | null` (valida um código ao expor).
- Eventos (já emitidos ao logar): **`cloud-my-tables`** `{tables:[{code,gmUid,gmName,name,...}]}` (as
  mesas que EU criei) e **`cloud-table-chars`** `{chars:[...]}` (personagens expostos A MIM, ao vivo).
  Também os da Fase 1: `cloud-auth`, `cloud-chars`, `cloud-error`, `cloud-ok`.
- **Expor/desexpor NÃO tem método próprio** — é um update do dono: você altera `char.sharedTables`/
  `char.sharedTo` e chama `updateCharacter(char.id, {...})` (já existe; sobe pra nuvem sozinho).

### Modelo de dados no personagem (seguir à risca)
- `char.sharedTables: [{ code, name, gmUid }]` — mesas às quais ESTE personagem está exposto.
- `char.sharedTo: [gmUid]` — **DERIVADO**: `unique(char.sharedTables.map(s => s.gmUid))`. É o que a
  regra e a query do mestre usam. **Recalcular sempre** que mexer em sharedTables (expor/desexpor).

### O que construir

1. **Expor um personagem (na ficha do jogador).** Na seção de esferas/conta da ficha (logado),
   por personagem ativo: um controle "Compartilhar com mesa" que pede um **código** →
   `const t = await window.Cloud.getTable(code)`; se `null` → `showCharNotice('Código de mesa inválido')`;
   senão adiciona `{code:t.code, name:t.name, gmUid:t.gmUid}` a `char.sharedTables` (sem duplicar por
   code), recalcula `char.sharedTo = unique(sharedTables.map(gmUid))`, e
   `updateCharacter(char.id, { sharedTables, sharedTo })` → `renderCharacter()`. Mostrar a lista das
   mesas em que o personagem está (nome + código), cada uma com **remover (desexpor)**: tira a entrada
   de `sharedTables`, recalcula `sharedTo`, `updateCharacter`.

2. **Criar mesa (para o mestre).** Um botão "Criar mesa" (na mesma área) → pede um nome →
   `const r = await window.Cloud.createTable(name)`; ao voltar `ok`, mostrar o **código** para
   compartilhar (ex.: `showCharNotice('Mesa criada — código: ' + r.code)` ou um bloco copiável).

3. **Navegação `#mesa` → `renderMyTable()`.** Em `navigate(hash)` (app.js ~4145), acrescentar
   `#mesa` ao bloco das views especiais (como `#personagem`) → `renderMyTable()`. Um link **"Minha
   mesa"** na navegação (mostrado só quando `window.Cloud?.isSignedIn()`), levando a `#mesa`.

4. **`renderMyTable()` — visão do mestre.** Usa o cache dos eventos (guarde os últimos
   `cloud-my-tables`/`cloud-table-chars` em vars module-level, setadas nos listeners do `setupCloud`;
   re-renderize `#mesa` quando chegarem, se a view atual for a mesa). Para cada mesa do mestre
   (`myTables`), liste os personagens expostos a ela (dos `exposedChars` cujo `sharedTables[].code`
   inclui o code da mesa) como **linha compacta**: nome · classe/subclasse · nível ·
   CD/PM/Ataque (use `characterStats(char)` → `Rules.derivedStats`). Clicar na linha **expande** a
   ficha somente-leitura (`renderSharedCharacterReadonly`). Estado de expandido/recolhido: um
   `Set` module-level de ids expandidos (view-state, não persistido), como o accordion.

5. **`renderSharedCharacterReadonly(char)` — ficha congelada.** Reusa a EXIBIÇÃO sem edição: o painel
   de stats (`buildCharBudgetHTML(char)` — confira que ele aceita um char passado, não só o ativo) e,
   por esfera do char, os cards via `charTalentCard(model.frag, id, kind, title)` (clona o card
   completo — já é read-only). **Sem** bancada, pickers, botões +/✕, "adicionar esfera". Percorra
   `char.spheres` + concedidas (`grantedSpheresMap(char)`) como o accordion faz, mas só listando os
   talentos (base/concedido/grátis/extra) — reutilize a lógica de `renderSphereBuildPanel` PODANDO os
   controles de edição, ou monte um render enxuto. Metamágica: liste `char.metamagic` se houver.

### Flags (não adivinhe — pergunte ao Arch)
- Toda mutação de exposição passa por `updateCharacter` (dono escreve; a regra já permite). Nunca
  escreva em personagem de outro usuário — o mestre é **somente-leitura** (a UI não deve nem tentar).
- `renderSharedCharacterReadonly` recebe um char de OUTRO usuário (não está no localStorage): não
  chame `getActiveChar()`/mutadores; só helpers de exibição que recebem o char por parâmetro.
- Não regredir: Fase 1 (login/sync), builder local deslogado, leitor estático. `navigate` das outras
  views intacto.
- Manter `typecheck`/`test`/`sanity-builder` verdes (app.js fora do typecheck). Gate real = teste do
  Owner com 2 contas; escreva o checklist no REVIEW-REQUEST.

### Definition of Done
- [ ] Logado: criar mesa mostra um código; expor um personagem a uma mesa (por código) e ver a lista
      de mesas do personagem (com desexpor). `sharedTo` sempre = únicos gmUid de `sharedTables`.
- [ ] "Minha mesa" (link só logado) → `#mesa` → mesas do mestre com os personagens expostos em lista
      compacta; clicar expande a ficha **somente-leitura** (stats + esferas/talentos), ao vivo.
- [ ] Deslogado / sem nuvem: nada de mesa aparece; builder local intacto; leitor intacto.
- [ ] `typecheck`/`test`/`sanity-builder` verdes; `REVIEW-REQUEST.md` com o checklist de 2 contas.

---

## Builder Plan
*Builder adds their plan here before building. Architect reviews and approves.*

Brief confirmed complete against actual code (`window.Cloud.createTable/getTable`, `cloud-my-tables`/
`cloud-table-chars` event shapes, `sharedTo`/`sharedTables` typedefs in `src/types.js`, firestore.rules
read grant) — matches the brief exactly. Proceeding without further Arch round-trip (brief is
unambiguous, DoD is precise). Plan, `app.js` only unless noted:

1. **Share bar on the char sheet** (near `buildAccountBar`, only when `Cloud.isSignedIn()`): "Criar
   mesa" (prompt name → `createTable`) + "Compartilhar com mesa" (prompt code → `getTable`, on `null`
   → `showCharNotice`), list of `char.sharedTables` chips with ✕ (desexpor). New helpers
   `deriveSharedTo`, `exposeCharToTable`, `unexposeCharFromTable`, all funnel through `updateCharacter`.
2. **Cache vars** `cloudMyTables`/`cloudTableChars` + `expandedMesaChars` (Set, view-state) at module
   level; wired in `setupCloud`'s two new listeners, re-render `renderMyTable()` only when
   `location.hash === '#mesa'` (more precise than the existing `currentChapterIndex === -1` checks —
   avoids yanking the user to a different synthetic view on an unrelated cloud event).
3. **`#mesa` route**: `navigate`/`handleInternalLinkClick` special-case list gets `#mesa`; sidebar gets
   a "Minha mesa" link (`display:none` by default, toggled by a new `updateTableLinkVisibility()`
   called from the `cloud-auth` listener).
4. **`renderMyTable()`**: per GM table, compact rows from `cloudTableChars` filtered by
   `sharedTables[].code`, click toggles `expandedMesaChars` + re-render, expanded row calls
   **`renderSharedCharacterReadonly(char)`** (new) which reuses `buildCharBudgetHTML`/`characterStats`/
   `charSphereTitles`/`grantedSpheresMap`/`getSphereModel`/`charTalentCard` — a lean render (per the
   brief's "or monte um render enxuto" option) rather than reusing `renderSphereBuildPanel` wholesale,
   since that function bakes in the manage-controls block. Extras rendered via
   `charTalentCard(fr, id, 'extra', title)` then `.char-talent-remove` stripped from the clone, so no
   edit affordance ships and no core helper needs a new "readonly" kind param.
5. `style.css`: new rules for the share bar (`.char-share*`) and the mesa view (`.mesa-*`), reusing
   existing tokens/patterns (`.char-sphere-remove`, `.acc-signin` button look, `.char-sphere-collapsed`
   row look) rather than inventing a new visual language.

No changes to `src/cloud.js`/`firestore.rules`. Building now.
