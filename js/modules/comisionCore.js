// Cómo se reparte una venta entre varios empleados.
//
// Vive aparte porque lo usan el reporte de comisiones y el detalle diario. Si
// cada uno repartiera por su cuenta, los dos reportes darían cifras distintas
// para la misma venta y no habría manera de saber cuál creer.
import { round2 } from '../utils.js';

/**
 * Parte `total` en `n` pedazos iguales, sin perder ni inventar centavos.
 *
 * Q100 entre 3 no da tres pedazos exactos: da 33.33 y sobra un centavo. Ese
 * centavo se le suma al primero, así la suma de las partes es SIEMPRE igual al
 * total. Si se repartiera con división simple, el reporte cerraría con un
 * centavo de diferencia y parecería un error de caja.
 */
export function repartirEntre(total, n) {
  if (!n) return [];
  const base = Math.floor((total * 100) / n) / 100;
  const partes = new Array(n).fill(base);
  partes[0] = round2(partes[0] + round2(total - base * n));
  return partes;
}
