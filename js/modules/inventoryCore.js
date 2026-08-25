// Helpers compartidos para mover inventario (compras, ventas, órdenes de servicio) y dejar historial.
import { adjustStockAtomic, adjustStockBatch } from '../data.js';
import { todayISO } from '../utils.js';

/** El documento de historial que acompaña a un movimiento de stock. */
function datosDelMovimiento(productId, delta, { motivo, referenciaId, usuario, fecha, extra = {} }) {
  return {
    productoId: productId,
    tipo: delta >= 0 ? 'entrada' : 'salida',
    motivo,
    cantidad: Math.abs(delta),
    referenciaId: referenciaId || null,
    usuarioId: usuario?.uid || null,
    usuarioNombre: usuario?.nombre || usuario?.username || 'Sistema',
    // Todo movimiento lleva `fecha` en AAAA-MM-DD: es lo que permite pedirle a
    // la base solo los movimientos de un período en vez de descargar el
    // historial completo, así que la pantalla no se hace lenta con los años.
    //
    // Va la fecha DEL DOCUMENTO que provocó el movimiento, no la de hoy. Al
    // cargar una venta de hace tres días, poner hoy hacía que el kardex dijera
    // que el producto salió un día en el que no hubo venta.
    fecha: fecha || todayISO(),
    ...extra, // nota y fecha propia para salidas manuales (uso propio)
  };
}

/**
 * Ajusta el stock de UN producto y deja su movimiento en el historial.
 * delta: positivo para entradas (compra), negativo para salidas (venta/servicio).
 *
 * Las dos cosas van dentro de la misma transacción: un viaje al servidor en vez
 * de dos, y sin el instante intermedio en que el stock ya bajó pero su
 * movimiento todavía no está escrito.
 */
export async function applyStockChange(productId, delta, opciones) {
  const { nuevoStock } = await adjustStockAtomic(productId, delta, datosDelMovimiento(productId, delta, opciones));
  return nuevoStock;
}

/**
 * Mueve el stock de VARIOS productos a la vez, en UNA sola transacción.
 *
 * Una venta de ocho productos ya no espera ocho viajes al servidor: espera uno.
 * Y si a uno de los ocho no le alcanza el stock, no se descuenta NINGUNO — antes
 * los primeros ya se habían ido y la venta fallaba a medias.
 *
 * @param {Array}  lineas    [{ productoId, delta, nombre }] con delta ya con signo
 * @param {Object} opciones  motivo, referenciaId, usuario, fecha, extra
 */
export async function applyStockChanges(lineas, opciones) {
  const conProducto = lineas.filter((l) => l.productoId);
  if (!conProducto.length) return [];
  const resultados = await adjustStockBatch(conProducto.map((l) => ({
    productId: l.productoId,
    delta: l.delta,
    movimiento: datosDelMovimiento(l.productoId, l.delta, opciones),
  })));
  return resultados.map((r) => r.nuevoStock);
}
