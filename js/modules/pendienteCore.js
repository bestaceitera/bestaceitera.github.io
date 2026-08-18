// Cuánto dinero de las ventas todavía NO ha llegado al banco, sumando TODOS los
// días, no solo el de hoy.
//
// Es la pieza que le faltaba al sistema. El cierre compara un día contra sí
// mismo: el 7 de agosto cerró "cuadrado" porque comparó Q379 contra Q379, y
// nunca preguntó si esos Q379 llegaron de verdad al banco. Como el depósito se
// registró por Q379 cuando la boleta decía Q310, el faltante quedó invisible
// durante días.
//
// Con esto el dinero pendiente se arrastra de un día a otro y está siempre a la
// vista: si no baja a cero, se nota.
import { round2, formatQ, escapeHtml, formatDateLong, todayISO } from '../utils.js';
import { getByDateRange } from '../data.js';
import { cuadrarPorDia } from './cuadreCore.js';

/**
 * Días que todavía deben dinero al banco, y el total.
 *
 * El control ARRANCA el primer día que se cerró o se depositó. Los días
 * anteriores son de antes de empezar a usar el cierre y el depósito —por
 * ejemplo, ventas viejas cargadas de golpe— y su dinero se manejó fuera del
 * sistema; contarlos llenaría la pantalla de un pendiente que nadie va a pagar.
 *
 * @param {Array}  dias      resultado de cuadrarPorDia
 * @param {Set}    cerrados  fechas que tienen un cierre vigente
 */
export function pendienteDeDepositar(dias, { cerrados = new Set() } = {}) {
  const orden = [...dias].sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  const arranque = orden.findIndex((d) => d.depositado > 0.009 || cerrados.has(d.fecha));
  if (arranque < 0) return { desde: null, dias: [], total: 0 };

  const deben = orden.slice(arranque).filter((d) => d.aDepositar > 0.009);
  return {
    desde: orden[arranque].fecha,
    dias: deben.sort((a, b) => (a.fecha < b.fecha ? -1 : 1)),
    total: round2(deben.reduce((s, d) => s + d.aDepositar, 0)),
  };
}

/**
 * Trae de la base lo justo para calcular el pendiente, buscando hacia atrás POR
 * TRAMOS en vez de bajar medio año de una.
 *
 * Antes se pedían 180 días fijos cada vez que se abría Ventas. Con seis meses de
 * historial eso son ~1,386 documentos y 472 KB por apertura, y como Firestore
 * cobra por documento leído, el plan gratuito solo aguantaría unas 36 aperturas
 * al día. Con los años la pantalla no se pone más lenta: se pone más CARA, hasta
 * que un día deja de responder por cuota agotada.
 *
 * Cuándo se puede dejar de mirar atrás, sin adivinar: `pendienteDeDepositar`
 * arranca el primer día que se cerró o se depositó e IGNORA todo lo anterior.
 * Así que si dentro del tramo se alcanza a ver un día MÁS VIEJO que ese arranque,
 * el arranque es el de verdad y no el borde del tramo: mirar más atrás no
 * cambiaría el resultado. Si no se ve, el tramo se quedó corto y se estira. El
 * último tramo (1,500 días) mira MÁS lejos de lo que se miraba antes, así que en
 * el caso raro se busca más, no menos.
 */
export async function calcularPendiente() {
  const TRAMOS = [30, 120, 400, 1500];
  let calculado = { desde: null, dias: [], total: 0 };
  let movimientosDelTramoAnterior = -1;
  for (const dias of TRAMOS) {
    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    const rango = { from: desde.toISOString().slice(0, 10), to: '2100-01-01' };
    const [movs, cierres] = await Promise.all([
      getByDateRange('cashMovements', rango, { max: 8000 }),
      getByDateRange('cashClosings', rango, { max: 1000 }),
    ]);
    const porDia = cuadrarPorDia(movs.filas);
    calculado = pendienteDeDepositar(porDia, {
      cerrados: new Set(cierres.filas.filter((c) => !c.anulado).map((c) => c.fecha)),
    });
    const vioAntesDelArranque = !!calculado.desde && porDia.some((d) => d.fecha < calculado.desde);
    // Se corta cuando la cuenta ya está completa (se vio un día anterior al
    // arranque), cuando no hay arranque que valga, o cuando estirar el tramo no
    // trajo ni un movimiento más: ahí se acabó el historial.
    if (!calculado.desde || vioAntesDelArranque || movs.filas.length === movimientosDelTramoAnterior) break;
    movimientosDelTramoAnterior = movs.filas.length;
  }
  return calculado;
}

/**
 * El aviso que se muestra arriba en Ventas. Vive aquí, junto al cálculo, para
 * que quien cambie uno vea el otro.
 */
export function avisoPendienteHtml(pendiente) {
  if (!pendiente || pendiente.total <= 0.009) return '';
  return `
    <div class="pendiente-banco">
      <div class="pendiente-cifra">
        <span>Pendiente de llevar al banco</span>
        <b>${formatQ(pendiente.total)}</b>
      </div>
      <div class="pendiente-dias">
        ${pendiente.dias.map((d) => `<span${d.fecha === todayISO() ? ' class="hoy"' : ''}>${escapeHtml(formatDateLong(d.fecha))}: <b>${formatQ(d.aDepositar)}</b></span>`).join('')}
      </div>
    </div>`;
}
