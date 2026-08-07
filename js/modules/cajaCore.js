// Escritura compartida de movimientos de caja, usada por ventas, servicios, compras, gastos y depósitos.
import { addRecord } from '../data.js';
import { todayISO, nowTimeHM } from '../utils.js';
import { getCurrentUser } from '../auth.js';

/**
 * tipo: 'entrada' | 'salida'
 * categoria: 'venta' | 'servicio' | 'abono' | 'otro_ingreso' | 'compra' | 'gasto' | 'devolucion' | 'retiro' | 'deposito' | 'fondo_inicial' | 'vuelto'
 */
/**
 * `responsable` es el empleado al que corresponde el movimiento (el que hizo la
 * venta o el servicio), que no siempre es la cuenta con la que se registró: en el
 * mostrador se usa una sola cuenta compartida. Se guarda AQUÍ, dentro del propio
 * movimiento, para que el historial de caja pueda mostrar quién fue sin tener que
 * descargar cientos de ventas y órdenes cada vez que se abre la pantalla.
 */
export async function addCashMovement({ tipo, categoria, monto, motivo, referenciaId = null, fecha = null, responsable = '' }) {
  const user = getCurrentUser();
  return addRecord('cashMovements', {
    tipo,
    categoria,
    monto: Number(monto),
    motivo: motivo || '',
    referenciaId,
    responsable: responsable || '',
    usuarioId: user?.uid || null,
    usuarioNombre: user?.nombre || user?.username || 'Sistema',
    // `fecha` permite registrar una venta de un día anterior sin descuadrar el arqueo de ese día.
    fecha: fecha || todayISO(),
    hora: nowTimeHM(),
  });
}
