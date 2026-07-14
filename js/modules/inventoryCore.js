// Helpers compartidos para mover inventario (compras, ventas, órdenes de servicio) y dejar kardex.
import { getById, updateRecord, addRecord } from '../data.js';

/**
 * Ajusta el stock de un producto y registra el movimiento en el kardex.
 * delta: positivo para entradas (compra), negativo para salidas (venta/servicio).
 */
export async function applyStockChange(productId, delta, { motivo, referenciaId, usuario }) {
  const product = await getById('products', productId);
  if (!product) throw new Error('Producto no encontrado.');
  const nuevoStock = Number(product.stock || 0) + delta;
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
  });
  return nuevoStock;
}
