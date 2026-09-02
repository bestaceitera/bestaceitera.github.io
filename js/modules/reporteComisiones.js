// Reporte de comisiones, detallado.
//
// Un solo cuadro agrupado por empleado: su nombre, debajo TODAS sus ventas con
// los productos de cada una, y al final su total y su comisión. Así el PDF que
// se imprime para la planilla explica de dónde sale cada cifra, en vez de dar un
// total que hay que creer a ciegas.
//
// El reparto de una venta compartida lo hace comisionCore —la MISMA función que
// usan el reporte de ventas y el detalle diario— y se hace sobre el TOTAL DE LA
// VENTA, no producto por producto: repartir línea por línea se vería más fino,
// pero cada línea redondearía por su cuenta y la suma del mes quedaría a unos
// centavos de lo que dicen los otros reportes.
import { renderTable, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { formatQ, round2, escapeHtml } from '../utils.js';
import { exportButtonsHtml, bindExportButtons } from '../export.js';
import { resumenPorEmpleado } from './comisionCore.js';
import { porRango, avisoDeTope, tomarTurno } from './reporteCore.js';

/** Cómo se compone la comisión cuando alguien tuvo más de un porcentaje. */
function explicarPct(r) {
  const partes = Object.entries(r.porPct);
  if (partes.length === 1) return `COMISIÓN (${r.pctLabel})`;
  return 'COMISIÓN — ' + partes
    .map(([pct, monto]) => `${formatQ(monto)} × ${Number(pct)}%`)
    .join(' + ');
}

async function renderComisiones(el) {
  let preset = 'mes';
  let range = applyRangePreset(preset);
  const turno = tomarTurno();

  async function draw() {
    const mio = turno.nuevo();
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    // Solo se piden los registros del período elegido, no todo el historial.
    const [sales, orders, invMovs] = await Promise.all([
      porRango('sales', range),
      porRango('serviceOrders', range),
      porRango('inventoryMovements', range, { max: 3000 }),
    ]);
    if (!turno.vigente(mio) || !el.isConnected) return;

    const totalVentas = round2(sales.reduce((s, v) => s + v.total, 0));
    const totalServicios = round2(orders.reduce((s, o) => s + o.total, 0));
    const totalNegocio = round2(totalVentas + totalServicios);

    const empleados = resumenPorEmpleado(sales, orders);
    const sumaDesglose = round2(empleados.reduce((s, r) => s + r.totalVendido, 0));
    const sinAsignar = round2(totalNegocio - sumaDesglose);
    const totalComisiones = round2(empleados.reduce((s, r) => s + r.comision, 0));

    // Productos que salieron para uso propio: NO son venta ni generan comisión.
    const usoPropio = invMovs.filter((m) => m.motivo === 'uso propio');
    const unidadesUsoPropio = usoPropio.reduce((s, m) => s + (Number(m.cantidad) || 0), 0);

    const cols = [
      { key: 'quien', label: 'Empleado / No.' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'detalle', label: 'Qué vendió' },
      { key: 'total', label: 'Total de la venta' },
      { key: 'leToca', label: 'Le cuenta a él' },
      { key: 'comision', label: 'Comisión' },
    ];

    // Un bloque por empleado: encabezado, sus ventas una por una, y el cierre
    // con su total y su comisión. Las filas de resumen van DENTRO de la tabla
    // para que salgan también en el PDF y el Excel.
    const filas = [];
    const encabezados = new Set();
    const totales = new Set();
    const comisiones = new Set();

    for (const e of empleados) {
      const operaciones = [...e.ventas, ...e.servicios]
        .sort((a, b) => (a.fecha === b.fecha ? String(a.numero).localeCompare(String(b.numero)) : (a.fecha < b.fecha ? -1 : 1)));

      const rotuloEmpleado = e.nombre.toUpperCase();
      encabezados.add(rotuloEmpleado);
      filas.push({
        quien: rotuloEmpleado, fecha: '',
        detalle: `${e.ventas.length} venta${e.ventas.length === 1 ? '' : 's'}${e.servicios.length ? ` y ${e.servicios.length} servicio${e.servicios.length === 1 ? '' : 's'}` : ''}`,
        total: '', leToca: formatQ(e.totalVendido), comision: formatQ(e.comision),
      });

      for (const o of operaciones) {
        filas.push({
          quien: `    ${o.numero}`, fecha: o.fecha,
          // Cuando la venta se atendió entre varios se dice aquí mismo: es la
          // única forma de entender por qué "le cuenta" menos que el total.
          detalle: o.detalle + (o.compartida > 1 ? `  (atendida entre ${o.compartida})` : ''),
          total: formatQ(o.total),
          leToca: formatQ(o.parte),
          comision: '',
        });
      }

      const rotuloTotal = `TOTAL ${rotuloEmpleado}`;
      totales.add(rotuloTotal);
      filas.push({ quien: rotuloTotal, fecha: '', detalle: '', total: '', leToca: formatQ(e.totalVendido), comision: '' });

      const rotuloComision = explicarPct(e);
      comisiones.add(rotuloComision);
      filas.push({ quien: rotuloComision, fecha: '', detalle: '', total: '', leToca: '', comision: formatQ(e.comision) });
    }

    if (filas.length) {
      filas.push({ quien: 'TOTAL A PAGAR EN COMISIONES', fecha: '', detalle: '', total: '',
                   leToca: formatQ(sumaDesglose), comision: formatQ(totalComisiones) });
      comisiones.add('TOTAL A PAGAR EN COMISIONES');
    }

    const claseDeFila = (f) => (encabezados.has(f.quien) ? 'fila-dia'
      : totales.has(f.quien) ? 'fila-total'
      : comisiones.has(f.quien) ? 'fila-comision' : '');

    el.innerHTML = `
      <div class="toolbar">${dateRangePresetButtons()}<div class="spacer"></div>${exportButtonsHtml()}</div>
      ${avisoDeTope(sales, orders, invMovs)}
      <p class="text-muted mt-16" style="margin-bottom:8px">Período: <b>${escapeHtml(range.from)}</b> a <b>${escapeHtml(range.to)}</b></p>
      <div class="grid grid-4">
        <div class="stat-card"><div class="label">Total vendido</div><div class="value">${formatQ(totalNegocio)}</div>
          <div class="sub">${formatQ(totalVentas)} en ventas · ${formatQ(totalServicios)} en servicios</div></div>
        <div class="stat-card"><div class="label">Total comisiones a pagar</div><div class="value">${formatQ(totalComisiones)}</div></div>
        <div class="stat-card"><div class="label">Ventas / órdenes</div><div class="value">${sales.length} / ${orders.length}</div></div>
        <div class="stat-card"><div class="label">Productos para uso propio</div><div class="value">${unidadesUsoPropio}</div><div class="sub">unidades — no es venta</div></div>
      </div>

      <div class="section-title">Qué vendió cada quien, venta por venta</div>
      <div class="card"><div id="rep-comisiones-table"></div></div>
      <p class="text-muted" style="font-size:12.5px;margin-top:8px">
        Cada empleado abre con su total y debajo van sus ventas con los productos de cada una.
        Cuando una venta la atienden entre varios, el monto <b>se reparte en partes iguales</b>:
        por eso "le cuenta a él" puede ser menor que el total de la venta.
        La comisión se aplica al <b>total acumulado del período</b>, no venta por venta.
      </p>
      ${sinAsignar > 0.009 ? `<p class="text-muted" style="font-size:12.5px;margin-top:8px">
          ${formatQ(sinAsignar)} del total no tiene empleado asignado (ventas registradas antes de exigirlo),
          así que no generan comisión para nadie.</p>` : ''}
      ${usoPropio.length ? `<p class="text-muted" style="font-size:12.5px;margin-top:8px">
          También salieron <b>${unidadesUsoPropio} unidad(es)</b> para uso propio, que no son venta ni generan
          comisión. El detalle está en la pestaña <b>Uso propio</b>.</p>` : ''}
    `;

    const t = renderTable({
      columns: cols, rows: filas, pageSize: 200,
      searchKeys: ['quien', 'detalle'],
      emptyMessage: 'Nadie tiene ventas en el período.',
      rowClass: claseDeFila,
    });
    const cont = el.querySelector('#rep-comisiones-table');
    cont.innerHTML = t.html;
    t.mount(cont);

    bindExportButtons(el, {
      title: `Comisiones detalladas por empleado (${range.from} a ${range.to})`,
      columns: cols, getRows: () => filas, filename: 'comisiones',
      // La columna de productos lleva texto largo: en hoja vertical se parte en
      // varios renglones y el PDF de la planilla se duplica de largo.
      apaisado: true,
    });
    bindRangeControls(el, (r, p) => { range = r; preset = p; draw(); }, { activo: preset });
  }

  draw();
}

export { renderComisiones };
