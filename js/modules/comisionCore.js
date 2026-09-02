// Cómo se reparte una venta entre varios empleados y cuánto le toca a cada uno.
//
// Vive aparte porque lo usan TRES reportes: Ventas, Comisiones y Detalle diario.
// Si cada uno hiciera su propia cuenta, tarde o temprano dirían cifras distintas
// para la misma venta y no habría forma de saber cuál creer.
import { round2, detalleDe } from '../utils.js';

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

/**
 * Cuánto vendió cada empleado en el período y cuánta comisión se le debe.
 *
 * La comisión NO se calcula venta por venta: se aplica al TOTAL acumulado del
 * período por cada porcentaje. Es distinto de sumar la comisión de cada venta
 * por separado cuando alguien tiene dos porcentajes distintos, y es como lo
 * quiere el dueño.
 *
 * Devuelve también el detalle de cada venta y orden que le cuenta a cada quien,
 * porque es lo primero que se pregunta al ver una cifra: "¿de dónde salió?".
 */
export function resumenPorEmpleado(ventas = [], ordenes = []) {
  const agg = new Map();

  const acumular = (nombre, tipo, detalle, monto, pct) => {
    if (!agg.has(nombre)) agg.set(nombre, { nombre, ventas: [], servicios: [], totalVendido: 0, porPct: {} });
    const a = agg.get(nombre);
    a[tipo].push(detalle);
    a.totalVendido = round2(a.totalVendido + monto);
    a.porPct[pct] = round2((a.porPct[pct] || 0) + monto);
  };

  const procesar = (registros, campoEmpleados, tipo) => {
    for (const r of registros) {
      const emps = r[campoEmpleados] || [];
      if (!emps.length) continue;
      const partes = repartirEntre(Number(r.total) || 0, emps.length);
      emps.forEach((e, i) => acumular(
        e.empleadoNombre || '(sin nombre)', tipo,
        // `detalle` es QUÉ se vendió. Sin eso, el reporte de comisiones dice
        // "V24 · Q365" y hay que abrir el sistema para saber de qué se trataba,
        // que es justo lo que el dueño quiere evitar al revisar la planilla.
        { numero: r.numero, fecha: r.fecha, detalle: detalleDe(r),
          total: Number(r.total) || 0, parte: partes[i], compartida: emps.length },
        partes[i], Number(e.comisionPct) || 0,
      ));
    }
  };
  procesar(ventas, 'empleadosComision', 'ventas');
  procesar(ordenes, 'empleados', 'servicios');

  for (const a of agg.values()) {
    a.comision = round2(Object.entries(a.porPct).reduce((s, [pct, monto]) => s + (monto * Number(pct)) / 100, 0));
    const pcts = Object.keys(a.porPct).map(Number);
    a.pctLabel = pcts.length === 1 ? `${pcts[0]}%` : 'varios %';
  }
  return [...agg.values()].sort((a, b) => b.totalVendido - a.totalVendido);
}
