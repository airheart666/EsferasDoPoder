// @ts-nocheck — glue de browser: imports do Firebase por URL (fora do alcance do tsc) + window.Cloud.
/* src/cloud.js — ponte de autenticação + sync (Firebase). MÓDULO ESM.
 *
 * O leitor é estático e NÃO carrega isto. Só o builder. localStorage continua a
 * cópia de trabalho síncrona (o app.js não vira async); aqui só espelhamos para/da
 * nuvem quando logado (offline-first). Comunicação com o app.js (script clássico):
 *   - expõe window.Cloud.{ signIn, signOut, user, isSignedIn, pushCharacter, removeCharacter }
 *   - emite eventos: 'cloud-auth' {user|null}, 'cloud-chars' {chars, fromCache}
 * Se não houver config (window.FIREBASE_CONFIG) ou o SDK falhar, window.Cloud fica
 * { available:false } e o app roda 100% local.
 */
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const cfg = window.FIREBASE_CONFIG;

const SDK = 'https://www.gstatic.com/firebasejs/10.12.0';

// Código de convite de mesa (= id do doc). Alfabeto sem ambíguos (O0 I1 L). Colisão
// (~30^6) é desprezível e, se ocorrer, o setDoc sobre mesa de outro gm é NEGADO pela
// regra (update exige gmUid do dono) → vira erro, nunca sobrescreve.
function genTableCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

async function boot() {
  if (!cfg) { window.Cloud = { available: false }; return; }
  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
          setPersistence, browserLocalPersistence, connectAuthEmulator } = await import(`${SDK}/firebase-auth.js`);
  const { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
          collection, doc, getDoc, setDoc, deleteDoc, query, where, onSnapshot, connectFirestoreEmulator } = await import(`${SDK}/firebase-firestore.js`);

  const app = initializeApp(cfg);
  const auth = getAuth(app);
  let db;
  try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
  catch (_) { db = getFirestore(app); } // incognito / navegador sem IndexedDB → sem cache offline

  if (window.FIREBASE_EMULATOR) { // teste local sem tocar produção
    try { connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true }); } catch (_) {}
    try { connectFirestoreEmulator(db, 'localhost', 8080); } catch (_) {}
  }

  let user = null;
  let unsub = null;
  const stopSync = () => { if (unsub) { unsub(); unsub = null; } };
  const startSync = uid => {
    stopSync();
    const q = query(collection(db, 'characters'), where('ownerUid', '==', uid));
    unsub = onSnapshot(q, snap => {
      const chars = [];
      snap.forEach(d => chars.push({ ...d.data(), id: d.id }));
      emit('cloud-chars', { chars, fromCache: snap.metadata.fromCache });
    }, err => { console.warn('[cloud] onSnapshot', err && err.code); emit('cloud-error', { op: 'read', code: (err && err.code) || 'erro' }); });
  };

  // FASE 2 — mesa/campanha: watchers do mestre (as mesas que EU criei + os personagens
  // expostos A MIM, ao vivo). Para não-mestre as queries voltam vazias (baratas).
  let unsubTables = null, unsubExposed = null;
  const stopTableSync = () => {
    if (unsubTables) { unsubTables(); unsubTables = null; }
    if (unsubExposed) { unsubExposed(); unsubExposed = null; }
  };
  const startTableSync = uid => {
    stopTableSync();
    unsubTables = onSnapshot(query(collection(db, 'tables'), where('gmUid', '==', uid)), snap => {
      const tables = []; snap.forEach(d => tables.push({ ...d.data(), code: d.id }));
      emit('cloud-my-tables', { tables });
    }, err => console.warn('[cloud] tables', err && err.code));
    unsubExposed = onSnapshot(query(collection(db, 'characters'), where('sharedTo', 'array-contains', uid)), snap => {
      const chars = []; snap.forEach(d => chars.push({ ...d.data(), id: d.id }));
      emit('cloud-table-chars', { chars });
    }, err => console.warn('[cloud] exposed', err && err.code));
  };

  onAuthStateChanged(auth, u => {
    user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null;
    if (u) { startSync(u.uid); startTableSync(u.uid); } else { stopSync(); stopTableSync(); }
    emit('cloud-auth', { user });
  });

  window.Cloud = {
    available: true,
    get user() { return user; },
    isSignedIn() { return !!user; },
    async signIn() {
      try {
        await setPersistence(auth, browserLocalPersistence);
        await signInWithPopup(auth, new GoogleAuthProvider());
        return { ok: true };
      } catch (e) { console.warn('[cloud] signIn', e && e.code); return { ok: false, code: e && e.code }; }
    },
    async signOut() { try { await signOut(auth); } catch (_) {} },
    // Grava o personagem inteiro como doc 'characters/{id}', com ownerUid do usuário
    // atual. char.updatedAt (Date.now, setado pelo app.js) é o carimbo de LWW.
    async pushCharacter(char) {
      if (!user || !char || !char.id) return;
      const { id } = char;
      try { await setDoc(doc(db, 'characters', id), { ...char, ownerUid: user.uid }); emit('cloud-ok', {}); }
      catch (e) { console.warn('[cloud] push', e && e.code); emit('cloud-error', { op: 'push', code: (e && e.code) || 'erro' }); }
    },
    async removeCharacter(id) {
      if (!user || !id) return;
      try { await deleteDoc(doc(db, 'characters', id)); } catch (e) { console.warn('[cloud] remove', e && e.code); emit('cloud-error', { op: 'remove', code: (e && e.code) || 'erro' }); }
    },
    // FASE 2 — mesas. Expor/desexpor um personagem é um update normal do dono (app.js
    // altera sharedTo/sharedTables e chama updateCharacter → pushCharacter). Aqui só a
    // criação/consulta de mesa.
    async createTable(name) {
      if (!user) return { ok: false };
      const code = genTableCode();
      try {
        await setDoc(doc(db, 'tables', code), { gmUid: user.uid, gmName: user.name || '', name: (name || 'Mesa').slice(0, 60), createdAt: Date.now() });
        return { ok: true, code, name: name || 'Mesa' };
      } catch (e) { console.warn('[cloud] createTable', e && e.code); return { ok: false, code: e && e.code }; }
    },
    async getTable(code) {
      if (!user || !code) return null;
      try { const s = await getDoc(doc(db, 'tables', String(code).trim().toUpperCase())); return s.exists() ? { code: s.id, ...s.data() } : null; }
      catch (e) { console.warn('[cloud] getTable', e && e.code); return null; }
    },
    async deleteTable(code) {
      if (!user || !code) return { ok: false };
      try { await deleteDoc(doc(db, 'tables', String(code))); return { ok: true }; }
      catch (e) { console.warn('[cloud] deleteTable', e && e.code); return { ok: false, code: e && e.code }; }
    },
  };
  emit('cloud-ready', {});
}

boot().catch(e => { console.warn('[cloud] boot falhou — modo local', e); window.Cloud = { available: false }; });
