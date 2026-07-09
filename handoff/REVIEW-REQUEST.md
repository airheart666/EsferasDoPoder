# Review Request — Nuvem Fase 1: login Google + sync offline-first
*Written by Architect (implemented inline). Read by Richard.*

Ready for Review: YES  ·  **NÃO testado em runtime** (precisa de browser + Firebase). Foco: corretude estática, segurança das regras, e a lógica de sync/guards.

---

## What Was Built (Fase 1 — durabilidade)

Persistência opcional na nuvem (Firebase), **offline-first**: o builder segue funcionando sem login
(localStorage como hoje); logar com Google faz backup/sync na nuvem. O leitor continua estático — o
SDK só é carregado quando o builder abre. Fase 2 (mesa/campanha) é depois.

## Files
| Arquivo | O quê |
|---|---|
| `firebase-config.js` (novo) | Config web PÚBLICO (seguro commitar; segurança = regras + domínios autorizados). `window.FIREBASE_CONFIG`. |
| `src/cloud.js` (novo, ESM, `@ts-nocheck`) | Ponte auth+sync. Importa Firebase v10 do gstatic por `import()` dinâmico. Expõe `window.Cloud.{signIn,signOut,user,isSignedIn,pushCharacter,removeCharacter}`; emite `cloud-auth`/`cloud-chars`. Firestore com `persistentLocalCache` (offline). Suporte a emulador via `window.FIREBASE_EMULATOR`. |
| `firestore.rules` (novo) | **Fase 1: dono lê/escreve só o seu personagem** (`ownerUid == auth.uid`, imutável); todo o resto negado. |
| `firebase.json`, `.firebaserc` (novos) | Config do emulador (auth 9099 / firestore 8080) + projeto `esferas-do-poder-5e`. |
| `index.html` | Carrega `firebase-config.js` antes do `app.js`. `cloud.js` é lazy (injetado pelo app.js). |
| `app.js` | (1) Seam: `createCharacter`/`updateCharacter` setam `updatedAt=Date.now()` e chamam `cloudPush`; `deleteCharacter`→`cloudRemove` (guardados: no-op sem login). (2) Bloco de nuvem: `ensureCloud` (lazy-load só quando o builder abre), `mergeCloudChars` (union LWW, nunca apaga local por ausência remota; migra na 1ª sync), `setupCloud` (listeners `cloud-auth`/`cloud-chars`), `buildAccountBar`, `cloudSignIn`. (3) `renderCharacter` chama `ensureCloud()` + insere a barra de conta; `setupCharacter` chama `setupCloud()` + handlers `.acc-signin`/`.acc-signout`. |
| `style.css` | `.char-account` (barra discreta). |
| `src/types.js` | `updatedAt`/`ownerUid`/`sharedTables?` no Character. |
| `package.json` | scripts `emulators` / `rules:deploy` (via `npx firebase-tools`). |

## Review focus (por ordem de risco)
1. **Regras de segurança (`firestore.rules`)** — crítico. Dono lê/escreve só o seu; `ownerUid` não
   pode ser forjado nem alterado; estranho é negado; catch-all nega. Alguma brecha? (Fase 1 não tem
   compartilhamento ainda — nada deve ser legível por terceiros.)
2. **Sync não perde dados** — `mergeCloudChars` faz union por LWW e **nunca** apaga um personagem
   local por ele faltar na nuvem (evita perda numa 1ª sync com cache vazio antes do servidor). Migra
   (sobe local) só 1x (`cloudMigrated`), pra deleção em outro aparelho não "ressuscitar". Confere o
   caso cache-vazio-depois-servidor e o LWW por `updatedAt`.
3. **Offline-first / guards** — sem `window.FIREBASE_CONFIG` ou se `cloud.js` falhar, `window.Cloud`
   fica ausente/`{available:false}` e todo o seam vira no-op → o builder roda 100% local. O leitor
   não carrega o SDK (lazy só no builder). Confirmar que nenhum caminho quebra deslogado/offline.
4. **Re-render em snapshot remoto** — `mergeCloudChars` só re-renderiza se `changed` e se estiver na
   ficha (`currentChapterIndex===-1`); a preservação de rolagem já existe. Sem loop de push↔snapshot?

## Verification
- Estático: `node --check app.js/src/cloud.js/firebase-config.js` ok; `typecheck` verde; `test` 35/35;
  `sanity-builder` 29/29. **Runtime NÃO testado** (login/popup/Firestore exigem browser + projeto).
- Recomendado antes de produção: (a) **rules unit test** com `@firebase/rules-unit-testing` no
  emulador (dono ok / estranho negado); (b) **teste manual do Owner** no browser (login Google,
  criar personagem, ver no console do Firestore, limpar cache, relogar, dados voltam); (c) confirmar
  que deslogado tudo funciona como antes.

## Notas / limitações conhecidas (Fase 1)
- Deleção não propaga entre aparelhos (union nunca apaga por ausência); melhora na Fase 2.
- LWW por `Date.now()` do cliente (não serverTimestamp) — simples; suscetível a relógio torto, ok p/ o caso.
- Avatar do Google com `referrerpolicy=no-referrer` (evita 429 do googleusercontent).
