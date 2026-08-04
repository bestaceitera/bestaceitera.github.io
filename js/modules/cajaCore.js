// Escritura compartida de movimientos de caja, usada por ventas, servicios, compras, gastos y depósitos.
import { addRecord } from '../data.js';
import { todayISO, nowTimeHM } from '../utils.js';
import { getCurrentUser } from '../auth.js';

/**
 * tipo: 'entrada' | 'salida'
 * categoria: 'venta' | 'servicio' | 'abono' | 'otro_ingreso' | 'compra' | 'gasto' | 'devolucion' | 'retiro' | 'deposito' | 'fondo_inicial' | 'vuelto'
 */
export async function addCashMovement({ tipo, categoria, monto, motivo, referenciaId = null, fecha = null }) {
  const user = getCurrentUser();
  return addRecord('cashMovements', {
    tipo,
    categoria,
    monto: Number(monto),
    motivo: motivo || '',
    referenciaId,
    usuarioId: user?.uid || null,
    usuarioNombre: user?.nombre || user?.username || 'Sistema',
    // `fecha` permite registrar una venta de un día anterior sin descuadrar el arqueo de ese día.
    fecha: fecha || todayISO(),
    hora: nowTimeHM(),
  });
}
