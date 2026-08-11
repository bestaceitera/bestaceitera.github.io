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
 */
export async function porRango(coleccion, rango, { max = 5000 } = {}) {
  const { filas } = await getByDateRange(coleccion, rango, { max });
  return filas;
}
