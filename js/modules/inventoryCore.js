// Helpers compartidos para mover inventario (compras, ventas, órdenes de servicio) y dejar historial.
import { adjustStockAtomic, addRecord } from '../data.js';
import { todayISO } from '../utils.js';

/**
 * Ajusta el stock de un producto y registra el movimiento en el historial.
 * delta: positivo para entradas (compra), negativo para salidas (venta/servicio).
 */
export async function applyStockChange(productId, delta, { motivo, referenciaId, usuario, extra = {} }) {
  // El descuento va en transacción: es lo que impide que dos ventas simultáneas
  // desde dos dispositivos saquen la misma última unidad dos veces.
  const { nombre, nuevoStock } = await adjustStockAtomic(productId, delta);
  await addRecord('inventoryMovements', {
    productoId: productId,
    productoNombre: nombre,
    tipo: delta >= 0 ? 'entrada' : 'salida',
    motivo,
    cantidad: Math.abs(delta),
    stockResultante: nuevoStock,
    referenciaId: referenciaId || null,
    usuarioId: usuario?.uid || null,
    usuarioNombre: usuario?.nombre || usuario?.username || 'Sistema',
    // TODO movimiento lleva `fecha` en formato AAAA-MM-DD (no "pendiente": se
    // refiere a que TODOS la llevan). Es lo que permite
    // pedirle a la base solo los movimientos de un período en vez de descargar
    // el historial completo, así que la pantalla no se hace lenta con los años.
    fecha: todayISO(),
    ...extra, // nota y fecha propia para salidas manuales (uso propio)
  });
  return nuevoStock;
}
