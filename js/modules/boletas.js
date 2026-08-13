// Las fotos de las boletas viven APARTE del depósito.
//
// Antes la foto iba dentro del documento del depósito, en `fotoBase64`. Firestore
// no sabe traer un documento sin uno de sus campos, así que CUALQUIER consulta de
// depósitos se arrastraba las fotos completas: la pantalla de Ventas descargaba
// 602 KB de boletas que no muestra en ningún lado, y eso crecía sin freno —
// 3.7 MB al mes, 44 MB al año. Ahí se iba la fluidez del programa.
//
// Ahora el depósito guarda solo `tieneFoto` (un sí o un no) y la imagen se
// guarda en su propia colección, con el mismo id. Las pantallas que solo
// necesitan saber si hay boleta pesan lo mismo para siempre, y la foto se baja
// únicamente cuando alguien la va a ver.
import { getById, setRecord, updateRecord, removeRecord } from '../data.js';

const enMemoria = new Map();

/**
 * Guarda la foto de un depósito, en su propia colección.
 *
 * Si esa colección todavía no está permitida en las reglas de Firestore, la foto
 * se guarda dentro del depósito como antes. Nunca se pierde una boleta ni se cae
 * el registro del depósito por un permiso que falta: el dinero ya se llevó al
 * banco y lo importante es que quede anotado.
 */
export async function guardarBoleta(depositoId, fotoBase64) {
  if (!fotoBase64) return;
  try {
    await setRecord('depositPhotos', depositoId, { fotoBase64 });
    enMemoria.set(depositoId, fotoBase64);
  } catch (err) {
    console.warn('Boleta aparte no disponible, se guarda dentro del depósito:', err.code || err.message);
    try { await updateRecord('deposits', depositoId, { fotoBase64 }); enMemoria.set(depositoId, fotoBase64); }
    catch (e2) { console.warn('Tampoco se pudo guardar la boleta:', e2.code || e2.message); }
  }
}

/**
 * Trae la foto de un depósito, solo cuando se va a mostrar.
 *
 * Los depósitos registrados antes de este cambio tienen la foto dentro del
 * propio documento; por eso se acepta pasarlo y se usa como respaldo. Así los
 * comprobantes viejos se siguen viendo sin tener que migrar nada a la fuerza.
 */
export async function traerBoleta(depositoId, depositoViejo = null) {
  if (enMemoria.has(depositoId)) return enMemoria.get(depositoId);
  if (depositoViejo?.fotoBase64) { enMemoria.set(depositoId, depositoViejo.fotoBase64); return depositoViejo.fotoBase64; }
  try {
    const doc = await getById('depositPhotos', depositoId);
    const foto = doc?.fotoBase64 || null;
    if (foto) enMemoria.set(depositoId, foto);
    return foto;
  } catch (err) {
    console.warn('No se pudo leer la boleta:', err.code || err.message);
    return null;
  }
}

/** ¿Este depósito tiene boleta? Sin descargarla. */
export function tieneBoleta(deposito) {
  return !!(deposito?.tieneFoto || deposito?.fotoBase64);
}

/** Al borrar un depósito se borra su foto: si no, quedaría ocupando espacio para siempre. */
export async function borrarBoleta(depositoId) {
  enMemoria.delete(depositoId);
  try { await removeRecord('depositPhotos', depositoId); } catch { /* puede no existir */ }
}
