// Cálculo del efectivo, compartido por Caja, Ventas y Reportes.
//
// Vive en un solo lugar a propósito: si cada pantalla hiciera su propia cuenta,
// tarde o temprano una diría un número y otra diría otro, y no habría forma de
// saber cuál creer. Todas las pantallas que hablan de dinero usan esto.
import { round2 } from '../utils.js';

/**
 * Cuánto efectivo se queda en el negocio como caja chica cuando ese día no se
 * registró un fondo inicial. Si sí se registró, manda el monto real de ese día.
 */
export const CAJA_CHICA_POR_DEFECTO = 105;

/**
 * Resume los movimientos de UN día.
 *
 * El VUELTO no es un egreso ni dinero que entró: si el cliente paga una venta de
 * Q90 con un billete de Q100, entraron Q90 al cajón y no se gastó nada. Por eso
 * se descuenta de ambos lados. El desglose (`ventas`, `servicios`, …) sí va en
 * bruto, porque ahí el vuelto se muestra en su propia línea.
 */
export function computeExpected(movements) {
  const fondoInicial = movements.filter((m) => m.categoria === 'fondo_inicial').reduce((s, m) => s + m.monto, 0);
  const byCat = (cat) => round2(movements.filter((m) => m.categoria === cat).reduce((s, m) => s + m.monto, 0));
  const vueltos = byCat('vuelto');

  const entradasBrutas = round2(movements
    .filter((m) => m.tipo === 'entrada' && m.categoria !== 'fondo_inicial')
    .reduce((s, m) => s + m.monto, 0));
  const salidasBrutas = round2(movements
    .filter((m) => m.tipo === 'salida')
    .reduce((s, m) => s + m.monto, 0));

  const totalEntradas = round2(entradasBrutas - vueltos);
  const totalSalidas = round2(salidasBrutas - vueltos);
  const esperado = round2(fondoInicial + totalEntradas - totalSalidas);

  return {
    fondoInicial, totalEntradas, totalSalidas, esperado,
    ventas: byCat('venta'), servicios: byCat('servicio'),
    otrosIngresos: byCat('abono') + byCat('otro_ingreso'),
    compras: byCat('compra'), gastos: byCat('gasto'), depositos: byCat('deposito'), vueltos,
    retiros: byCat('retiro'), devoluciones: byCat('devolucion'),
  };
}

/**
 * Arma el cuadre de cada día a partir de una lista de movimientos de varios días.
 *
 *   efectivo de ventas = entradas − salidas
 *   a depositar        = ese mismo efectivo de ventas
 *
 * LA CAJA CHICA NO SE CUENTA. En este negocio es un monto fijo que vive aparte
 * del dinero del día: no se deposita y no se cuenta al cerrar. Al cierre se
 * cuenta SOLO lo que entró por ventas, y todo eso se va al banco. Antes se
 * sumaba al total esperado, y como aquí la caja chica vale Q105 —lo mismo que
 * una transferencia de ese día— los números se confundían entre sí.
 *
 * Los depósitos ya hechos cuentan como salida, así que "a depositar" siempre
 * muestra lo que TODAVÍA falta llevar al banco, no lo del día entero.
 */
export function cuadrarPorDia(movimientos, { cajaChicaPorDefecto = CAJA_CHICA_POR_DEFECTO } = {}) {
  const porDia = new Map();
  for (const m of movimientos) {
    const dia = m.fecha || '';
    if (!dia) continue;
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(m);
  }
  return [...porDia.entries()]
    .map(([fecha, movs]) => {
      const stats = computeExpected(movs);
      const tuvoFondo = stats.fondoInicial > 0;
      const cajaChica = tuvoFondo ? round2(stats.fondoInicial) : cajaChicaPorDefecto;
      // Solo el dinero de las ventas del día: es lo que se cuenta al cerrar y lo
      // que se lleva al banco. La caja chica queda fuera de esta cuenta.
      const efectivoVentas = round2(stats.totalEntradas - stats.totalSalidas);
      return {
        fecha, ...stats, tuvoFondo, cajaChica,
        efectivoVentas,
        depositado: stats.depositos,
        aDepositar: round2(Math.max(0, efectivoVentas)),
      };
    })
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

/** Indexa el resultado de `cuadrarPorDia` por fecha, para consultarlo día a día. */
export function cuadrePorFecha(movimientos, opciones) {
  const mapa = new Map();
  for (const d of cuadrarPorDia(movimientos, opciones)) mapa.set(d.fecha, d);
  return mapa;
}
