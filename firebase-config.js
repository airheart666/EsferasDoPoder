/* Firebase — configuração web PÚBLICA (não é segredo).
 * A segurança vem das regras do Firestore (firestore.rules) + dos domínios
 * autorizados no console. Carregado como <script> clássico antes de src/cloud.js
 * (módulo ESM), que lê window.FIREBASE_CONFIG. Só o builder usa; o leitor é estático.
 * Para desligar a nuvem, basta remover esta config (o app cai no modo local). */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDqQS8skzGyebV2zgNoSW0QBl4MJBhBTPM",
  authDomain: "esferas-do-poder-5e.firebaseapp.com",
  projectId: "esferas-do-poder-5e",
  storageBucket: "esferas-do-poder-5e.firebasestorage.app",
  messagingSenderId: "209069462152",
  appId: "1:209069462152:web:30c2f19536c7c41026453d"
};
