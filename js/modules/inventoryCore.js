// Helpers compartidos para mover inventario (compras, ventas, órdenes de servicio) y dejar historial.
import { getById, updateRecord, addRecord } from '../data.js';

/**
 * Ajusta el stock de un producto y registra el movimiento en el historial.
 * delta: positivo para entradas (compra), negativo para salidas (venta/servicio).
 */
export async function applyStockChange(productId, delta, { motivo, referenciaId, usuario, extra = {} }) {
  const product = await getById('products', productId);
  if (!product) throw new Error('Producto no encontrado.');
  const nuevoStock = Number(product.stock || 0) + delta;
  // El stock nunca debe quedar negativo, ni siquiera si dos ventas coinciden.
  if (nuevoStock < 0) throw new Error(`No hay suficiente stock de ${product.nombre} (quedan ${product.stock || 0}).`);
  await updateRecord('products', productId, { stock: nuevoStock });
  await addRecord('inventoryMovements', {
    productoId: productId,
    productoNombre: product.nombre,
    tipo: delta >= 0 ? 'entrada' : 'salida',
    motivo,
    cantidad: Math.abs(delta),
    stockResultante: nuevoStock,
    referenciaId: referenciaId || null,
    usuarioId: usuario?.uid || null,
    usuarioNombre: usuario?.nombre || usuario?.username || 'Sistema',
    ...extra, // nota y fecha para salidas manuales (uso propio)
  });
  return nuevoStock;
}
