import { auth, authApi } from './firebase-config.js';
import { getById, setRecord } from './data.js';

const {
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} = authApi;

export const EMAIL_DOMAIN = 'aceitera.local';

export function usernameToEmail(username) {
  return `${username.trim().toLowerCase()}@${EMAIL_DOMAIN}`;
}

export function emailToUsername(email) {
  return email.split('@')[0];
}

let currentProfile = null;

export function getCurrentUser() {
  return currentProfile;
}

// Por seguridad, un usuario solo puede auto-crear su PROPIO perfil la primera vez
// que inicia sesión, y siempre queda como "empleado" (las reglas de Firestore lo
// exigen así). Para que la cuenta de bestprice07 sea Administrador, ese primer
// cambio de rol se hace una sola vez a mano desde la consola de Firebase — ver
// instrucciones de configuración.
async function ensureProfile(fbUser) {
  const existing = await getById('users', fbUser.uid);
  if (existing) {
    currentProfile = { ...existing, uid: fbUser.uid };
    return currentProfile;
  }
  const username = emailToUsername(fbUser.email || '');
  const profile = { username, nombre: username, role: 'empleado', activo: true };
  await setRecord('users', fbUser.uid, profile);
  currentProfile = { uid: fbUser.uid, ...profile };
  return currentProfile;
}

/** Se dispara en cada cambio de sesión (login/logout/recarga de página). */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      currentProfile = null;
      callback(null);
      return;
    }
    try {
      const profile = await ensureProfile(fbUser);
      if (profile.activo === false) {
        await signOut(auth);
        currentProfile = null;
        callback(null, 'Tu usuario está inactivo. Contacta al administrador.');
        return;
      }
      // Los empleados existen solo para asignar ventas y comisiones: no son
      // cuentas de acceso. Solo el administrador y la cuenta de empleado entran.
      if (profile.tipo === 'empleado') {
        await signOut(auth);
        currentProfile = null;
        callback(null, 'Este nombre es de un empleado (para comisiones), no una cuenta de acceso.');
        return;
      }
      callback({ uid: fbUser.uid, ...profile });
    } catch (err) {
      console.error('ensureProfile', err);
      callback(null, 'No se pudo cargar tu perfil. Intenta de nuevo.');
    }
  });
}

export async function login(username, password) {
  const email = usernameToEmail(username);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return ensureProfile(cred.user);
}

export async function logout() {
  currentProfile = null;
  await signOut(auth);
}

export async function changeOwnPassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  if (!user) throw new Error('No hay sesión activa.');
  const cred = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, cred);
  await updatePassword(user, newPassword);
}

export function isAdmin() {
  return currentProfile?.role === 'admin';
}

export function friendlyAuthError(err) {
  const code = err?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'Usuario o contraseña incorrectos.';
  }
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera un momento e intenta de nuevo.';
  if (code.includes('network-request-failed')) return 'Sin conexión a internet.';
  return 'No se pudo iniciar sesión. Intenta de nuevo.';
}
