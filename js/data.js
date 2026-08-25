import { db, fsApi } from './firebase-config.js';

const {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc,
  query, orderBy, where, onSnapshot, serverTimestamp, runTransaction, Timestamp,
} = fsApi;

function col(name) {
  return collection(db, name);
}

/**
 * `max` limita cuántos documentos se traen. Es importante para que el sistema
 * siga siendo rápido y barato dentro del plan gratuito cuando, con los años,
 * haya miles de ventas y movimientos guardados.
 */
/**
 * Cuánto se espera por una consulta antes de darla por perdida.
 *
 * Sin esto, una consulta que nunca contesta —señal intermitente, la pestaña
 * dormida, demasiadas consultas a la vez— deja la pantalla en "Cargando…" para
 * siempre y solo se sale recargando la página. Con el tope, falla y avisa: un
 * error se puede reintentar, una pantalla congelada no.
 *
 * Medio minuto es de sobra: una consulta normal tarda menos de medio segundo.
 * Se deja holgado a propósito para no asustar con un aviso falso cuando la
 * conexión del negocio anda lenta.
 */
const TIEMPO_MAXIMO_MS = 30000;

function conTiempoLimite(promesa, que) {
  let reloj;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error(`la consulta de ${que} tardó demasiado; revisa la conexión`)), TIEMPO_MAXIMO_MS);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

export async function getAll(name, { order, direction = 'asc', filters = [], max } = {}) {
  let q = col(name);
  const clauses = filters.map((f) => where(f[0], f[1], f[2]));
  if (order) clauses.push(orderBy(order, direction));
  if (max) clauses.push(fsApi.limit(max));
  if (clauses.length) q = query(col(name), ...clauses);
  const snap = await conTiempoLimite(getDocs(q), name);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Cuenta los documentos de una colección SIN descargarlos. Firestore lo resuelve
 * en el servidor y cobra 1 sola lectura, sin importar si hay 10 o 50,000 registros.
 * Es lo que permite que el dashboard siga instantáneo con los años.
 */
export async function countRecords(name) {
  try {
    const snap = await fsApi.getCountFromServer(col(name));
    return snap.data().count;
  } catch (err) {
    console.warn(`countRecords(${name})`, err.code || err.message);
    return 0;
  }
}

/**
 * Trae SOLO los documentos cuyo campo de fecha cae dentro del período pedido.
 * Firestore resuelve el rango en el servidor, así que la pantalla tarda lo mismo
 * el primer día que dentro de diez años: se descarga el mes que se está viendo,
 * no todo el historial. Como el filtro y el orden usan el MISMO campo, Firestore
 * no pide crear ningún índice extra.
 *
 * Devuelve { filas, truncado }: `truncado` avisa que el período elegido tiene más
 * registros de los que se pidieron, para no mostrar totales incompletos como si
 * fueran completos.
 */
export async function getByDateRange(name, { from, to }, { max = 1500, campo = 'fecha' } = {}) {
  const filters = [];
  if (from && from > '2000-01-01') filters.push([campo, '>=', from]);
  if (to && to < '2100-01-01') filters.push([campo, '<=', to]);
  const filas = await getAll(name, { filters, order: campo, direction: 'desc', max: max + 1 });
  const truncado = filas.length > max;
  return { filas: truncado ? filas.slice(0, max) : filas, truncado };
}

export async function getById(name, id) {
  const snap = await getDoc(doc(db, name, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function addRecord(name, data) {
  const ref = await addDoc(col(name), { ...data, createdAt: serverTimestamp() });
  return ref.id;
}

/**
 * Un id nuevo, generado AQUÍ, sin preguntarle al servidor.
 *
 * Firestore garantiza que no se repite. Sirve para no tener que esperar a que el
 * servidor devuelva el id de la venta antes de poder tocar el inventario, que es
 * un viaje entero de espera con el cliente enfrente del mostrador.
 */
export function nuevoId(coleccion) {
  return doc(col(coleccion)).id;
}

export async function setRecord(name, id, data) {
  const { setDoc } = fsApi;
  await setDoc(doc(db, name, id), { ...data, createdAt: serverTimestamp() });
  return id;
}

export async function updateRecord(name, id, data) {
  await updateDoc(doc(db, name, id), { ...data, updatedAt: serverTimestamp() });
}

export async function removeRecord(name, id) {
  await deleteDoc(doc(db, name, id));
}

export function listen(name, callback, { order, direction = 'asc', filters = [], max } = {}) {
  const clauses = filters.map((f) => where(f[0], f[1], f[2]));
  if (order) clauses.push(orderBy(order, direction));
  if (max) clauses.push(fsApi.limit(max));
  const q = clauses.length ? query(col(name), ...clauses) : col(name);
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  }, (err) => console.error(`listen(${name})`, err));
}

/**
 * Suma `delta` al stock de un producto DENTRO de una transacción.
 *
 * Es indispensable que sea transaccional: si dos personas venden a la vez la
 * última unidad desde dos dispositivos, leer-restar-guardar por separado deja
 * que ambas ventas pasen y solo se descuente una (la segunda escritura pisa a la
 * primera), quedando vendido algo que ya no existe. Firestore reintenta la
 * transacción cuando detecta que el dato cambió, así que la segunda venta vuelve
 * a leer el stock ya rebajado y se rechaza como debe ser.
 */
export async function adjustStockAtomic(productId, delta, movimiento = null) {
  const [r] = await adjustStockBatch([{ productId, delta, movimiento }]);
  return r;
}

/**
 * Mueve el stock de VARIOS productos en UNA SOLA transacción, y escribe sus
 * movimientos de historial dentro de la misma.
 *
 * Por qué una sola y no una por producto:
 *
 *  - VELOCIDAD. Medido contra la base real: una transacción tarda ~360 ms, y
 *    ocho lanzadas juntas tardan ~1,530 ms (Firestore no las resuelve del todo
 *    en paralelo). Una sola transacción para los ocho productos tarda lo que
 *    una. En una venta grande eso es la diferencia entre el mostrador esperando
 *    un segundo o esperando cinco con la pantalla congelada.
 *
 *  - CORRECCIÓN. Antes, si el quinto producto no tenía stock, los cuatro
 *    primeros YA se habían descontado y la venta fallaba a medias. Ahora se
 *    valida todo primero: o pasa la venta entera, o no se toca nada.
 *
 * Firestore exige que TODAS las lecturas vayan antes que las escrituras dentro
 * de una transacción, por eso el bucle está partido en dos.
 */
export async function adjustStockBatch(cambios) {
  if (!cambios.length) return [];

  // Si el mismo producto viene dos veces (dos líneas del mismo aceite), se juntan:
  // leer el mismo documento dos veces en una transacción devuelve el mismo estado
  // y el segundo descuento pisaría al primero.
  const porProducto = new Map();
  for (const c of cambios) {
    if (!porProducto.has(c.productId)) porProducto.set(c.productId, { productId: c.productId, delta: 0, movimientos: [] });
    const g = porProducto.get(c.productId);
    g.delta += c.delta;
    if (c.movimiento) g.movimientos.push(c.movimiento);
  }
  const grupos = [...porProducto.values()];

  return runTransaction(db, async (tx) => {
    // ---- Primero TODAS las lecturas, y JUNTAS ----
    // En fila costaban un viaje al servidor cada una: con ocho productos, 1,487 ms
    // dentro de la propia transacción. Juntas, Firestore las resuelve de un tiro.
    const refs = grupos.map((g) => doc(db, 'products', g.productId));
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));

    // ---- Se valida todo ANTES de escribir nada ----
    const resultados = grupos.map((g, i) => {
      const snap = snaps[i];
      if (!snap.exists()) throw new Error('Producto no encontrado.');
      const producto = snap.data();
      const anterior = Number(producto.stock || 0);
      const nuevoStock = anterior + g.delta;
      if (nuevoStock < 0) {
        throw new Error(`No hay suficiente stock de ${producto.nombre} (quedan ${anterior}).`);
      }
      return { nombre: producto.nombre, nuevoStock };
    });

    // ---- Y recién ahora las escrituras ----
    grupos.forEach((g, i) => {
      tx.update(refs[i], { stock: resultados[i].nuevoStock, updatedAt: serverTimestamp() });
      // Cuando dos líneas eran del mismo producto, cada una deja su movimiento:
      // el historial tiene que reflejar lo que se tecleó, no el neto.
      let restante = resultados[i].nuevoStock;
      for (const m of g.movimientos) {
        tx.set(doc(collection(db, 'inventoryMovements')), {
          ...m,
          productoNombre: resultados[i].nombre,
          stockResultante: restante,
          createdAt: serverTimestamp(),
        });
      }
    });
    return resultados;
  });
}

/** Incrementa de forma atómica un contador y devuelve el folio como string con padding. */
export async function nextFolio(counterName, { prefix = '', pad = 6 } = {}) {
  const ref = doc(db, 'counters', counterName);
  const value = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? snap.data().value : 0;
    const next = current + 1;
    tx.set(ref, { value: next }, { merge: true });
    return next;
  });
  return `${prefix}${String(value).padStart(pad, '0')}`;
}
