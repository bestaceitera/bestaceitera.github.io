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

// Versión del SDK de Firebase. Se usa solo aquí, para construir las tres URLs.
const SDK_VERSION = '10.12.2';

const { initializeApp } = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`);
const authMod = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-auth.js`);
const fsMod = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-firestore.js`);

// No se exporta: solo lo usan getAuth() e initializeFirestore() aquí abajo.
const app = initializeApp(firebaseConfig);
export const auth = authMod.getAuth(app);

/**
 * La sesión vive SOLO mientras el navegador está abierto.
 *
 * Por defecto Firebase la guarda en el disco: al abrir el link entrabas directo
 * al sistema, con la cuenta del último que lo usó. En un mostrador compartido
 * eso significa que el empleado podía caer en la sesión del administrador y ver
 * comisiones, compras y gastos sin haber puesto una contraseña.
 *
 * Con esto, refrescar la página no molesta —la sesión sigue— pero al cerrar el
 * navegador se pide usuario y contraseña otra vez.
 */
export const sesionLista = authMod
  .setPersistence(auth, authMod.browserSessionPersistence)
  .catch((err) => {
    // Si el navegador no lo permite, se sigue con lo que haya: peor es no poder
    // entrar al sistema.
    console.warn('No se pudo limitar la sesión al navegador:', err?.code || err?.message);
  });

/**
 * Guarda una copia local de los datos en el navegador.
 *
 * Sin esto, si se cae el internet las pantallas no fallan: muestran CERO
 * registros, que es peor, porque parece que se borró todo. Con la copia local
 * siguen mostrando lo último que se sabía y el sistema sigue usable mientras
 * vuelve la señal. `persistentMultipleTabManager` permite tener el sistema
 * abierto en varias pestañas o dispositivos sin que se peleen por la copia.
 *
 * Si el navegador no lo permite (modo incógnito, poco espacio), se cae de vuelta
 * a la memoria: el sistema funciona igual, solo sin copia entre recargas.
 */
function crearFirestore() {
  try {
    return fsMod.initializeFirestore(app, {
      localCache: fsMod.persistentLocalCache({ tabManager: fsMod.persistentMultipleTabManager() }),
    });
  } catch (err) {
    console.warn('Sin copia local de datos (se usará solo memoria):', err?.message || err);
    return fsMod.getFirestore(app);
  }
}
export const db = crearFirestore();

export const authApi = authMod;
export const fsApi = fsMod;

export const isConfigured = firebaseConfig.apiKey !== 'PEGA_AQUI_TU_API_KEY';
