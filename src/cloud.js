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

async function boot() {
  if (!cfg) { window.Cloud = { available: false }; return; }
  const { initializeApp } = await import(`${SDK}/firebase-app.js`);
  const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
          setPersistence, browserLocalPersistence, connectAuthEmulator } = await import(`${SDK}/firebase-auth.js`);
  const { initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
          collection, doc, setDoc, deleteDoc, query, where, onSnapshot, connectFirestoreEmulator } = await import(`${SDK}/firebase-firestore.js`);

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

  onAuthStateChanged(auth, u => {
    user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoURL || '' } : null;
    if (u) startSync(u.uid); else stopSync();
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
  };
  emit('cloud-ready', {});
}

boot().catch(e => { console.warn('[cloud] boot falhou — modo local', e); window.Cloud = { available: false }; });
