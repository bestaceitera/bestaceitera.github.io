// Catálogos en memoria: productos, clientes, empleados y bancos.
//
// El formulario de venta los volvía a descargar CADA VEZ que se tocaba "Nueva
// venta": con 155 productos eso es casi un segundo de espera con el cliente
// enfrente, y en un día de trabajo son miles de lecturas repetidas de datos que
// casi nunca cambian.
//
// Aquí se descargan una sola vez por sesión y después se mantienen solos con una
// escucha en vivo: si alguien agrega un producto desde el otro dispositivo, la
// copia se actualiza sola en el momento, sin recargar nada.
//
// La primera carga se comporta EXACTAMENTE igual que antes (si falla, el error
// llega a quien lo pidió). Si más adelante la escucha se cae, se sigue sirviendo
// la última copia buena en vez de dejar la pantalla sin datos: para elegir un
// producto, una lista de hace un minuto sirve; una lista vacía no.
//
// El stock que se ve aquí NO es la última palabra: antes de guardar, la venta
// vuelve a comprobar contra la base cuánto queda de cada producto. Así una copia
// de un segundo de antigüedad nunca puede vender algo que ya no existe.
import { getAll, listen } from '../data.js';

const memoria = new Map();

/**
 * Devuelve el catálogo pedido, de memoria si ya se cargó en esta sesión.
 * @param {string} nombre    colección de Firestore
 * @param {object} opciones  mismas que getAll (order, direction, filters…)
 */
export async function catalogo(nombre, opciones = {}) {
  let e = memoria.get(nombre);
  if (!e) { e = { filas: null, unsub: null }; memoria.set(nombre, e); }
  if (e.filas) return e.filas;

  e.filas = await getAll(nombre, opciones);
  if (!e.unsub) {
    e.unsub = listen(nombre, (filas) => { e.filas = filas; }, opciones);
  }
  return e.filas;
}

/**
 * Suelta las escuchas y vacía la memoria. Se llama al cerrar sesión: sin sesión,
 * Firestore rechaza las escuchas por permisos y ensuciarían la consola; y la
 * siguiente persona que entre no debe ver los datos de la anterior.
 */
export function soltarCatalogos() {
  for (const e of memoria.values()) {
    if (e.unsub) { try { e.unsub(); } catch { /* ya estaba cerrada */ } }
  }
  memoria.clear();
}
