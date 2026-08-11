// Piezas que comparten todos los reportes.
//
// `porRango` estaba copiada en los cuatro archivos de reportes. Cuatro copias de
// la misma consulta significan cuatro topes distintos el día que alguien cambie
// uno solo, y un reporte mostrando menos registros que otro para el mismo
// período sin que nada avise.
import { getByDateRange } from '../data.js';

/**
 * Trae los registros de un período.
 *
 * El tope es más alto que el de las pantallas de operación a propósito: un
 * reporte mira meses o años, no el día de hoy.
 *
 * Si el período trae MÁS registros que el tope, la lista devuelta queda marcada
 * con `.topeAlcanzado`. Esto importa mucho más de lo que parece: un reporte de
 * dinero que suma solo una parte de los registros y muestra el resultado como si
 * fuera el total es peor que un reporte que no carga. Antes ese aviso se perdía
 * aquí dentro. Ahora viaja con los datos y `avisoDeTope()` lo convierte en un
 * mensaje visible.
 */
export async function porRango(coleccion, rango, { max = 5000 } = {}) {
  const { filas, truncado } = await getByDateRange(coleccion, rango, { max });
  // Propiedad no enumerable: no aparece al recorrer ni al exportar la lista,
  // pero viaja con ella hasta quien la dibuja.
  Object.defineProperty(filas, 'topeAlcanzado', { value: truncado, enumerable: false });
  Object.defineProperty(filas, 'coleccion', { value: coleccion, enumerable: false });
  return filas;
}

const NOMBRES = {
  sales: 'ventas', serviceOrders: 'órdenes de servicio', cashMovements: 'movimientos de caja',
  deposits: 'depósitos', inventoryMovements: 'movimientos de inventario', purchases: 'compras',
};

/**
 * Devuelve el aviso a mostrar si alguna de las listas quedó recortada, o cadena
 * vacía si todas vinieron completas. Se pone ARRIBA de las cifras, no abajo:
 * quien ve un total tiene que enterarse antes de anotarlo.
 */
export function avisoDeTope(...listas) {
  const recortadas = listas.filter((l) => l && l.topeAlcanzado);
  if (!recortadas.length) return '';
  const que = recortadas.map((l) => NOMBRES[l.coleccion] || l.coleccion).join(' y ');
  return `<div class="alert alert-warning mt-16">
    <b>Este período tiene demasiados registros y no cabe completo.</b><br>
    Las cifras de abajo <b>no incluyen</b> todas las ${que} del período: elige un
    rango más corto (por ejemplo un mes) para ver el total real.
  </div>`;
}

/**
 * Qué se vendió en una venta o qué se hizo en una orden, en una sola línea.
 *
 * Es la columna que faltaba en el reporte de ventas: sin ella el PDF solo decía
 * "V24 · Q365" y había que abrir el sistema para saber de qué se trataba, que es
 * justo lo que un reporte impreso debería evitar.
 */
export function detalleDe(registro) {
  const partes = [];
  // Venta: los productos con su cantidad cuando es más de uno.
  for (const i of registro.items || []) {
    partes.push(`${i.nombre}${(Number(i.cantidad) || 1) > 1 ? ` ×${i.cantidad}` : ''}`);
  }
  // Orden de servicio: primero los servicios, luego los productos usados.
  for (const s of registro.servicios || []) partes.push(s.nombre);
  for (const p of registro.productos || []) {
    partes.push(`${p.nombre}${(Number(p.cantidad) || 1) > 1 ? ` ×${p.cantidad}` : ''}`);
  }
  if (Number(registro.costoManoObra) > 0) partes.push('mano de obra');
  return partes.join(', ') || '—';
}
