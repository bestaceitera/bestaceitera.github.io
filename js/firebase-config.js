// ============================================================================
// PEGA AQUÍ las llaves de tu proyecto de Firebase.
// Las obtienes en: Firebase Console → Configuración del proyecto (⚙️) →
// "Tus apps" → app web → "Configuración del SDK".
// Estas llaves son públicas (no son secretas); la seguridad real la dan las
// reglas de Firestore (ver firestore.rules). No usamos Firebase Storage: las
// fotos de depósitos se guardan comprimidas directo en Firestore, para que el
// sistema funcione en el plan gratuito sin necesidad de tarjeta.
// ============================================================================
const firebaseConfig = {
  apiKey: "AIzaSyAb-asY-QtF78tubT2ZyzYZk8pp1XYPHHw",
  authDomain: "aceitera-best.firebaseapp.com",
  projectId: "aceitera-best",
  storageBucket: "aceitera-best.firebasestorage.app",
  messagingSenderId: "240475425530",
  appId: "1:240475425530:web:676ce92705d72ac41ad743",
};

export const SDK_VERSION = '10.12.2';

const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`);
const authMod = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`);
const fsMod = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`);

export const app = initializeApp(firebaseConfig);
export const auth = authMod.getAuth(app);
export const db = fsMod.getFirestore(app);

export const authApi = authMod;
export const fsApi = fsMod;

export const isConfigured = firebaseConfig.apiKey !== 'PEGA_AQUI_TU_API_KEY';

// Usados por usuarios.js para crear cuentas nuevas en una app secundaria
// (así no se cierra la sesión del administrador que está creándolas).
export const config = firebaseConfig;
export const initializeApp_ = initializeApp;
