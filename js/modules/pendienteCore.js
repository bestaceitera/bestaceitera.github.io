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
