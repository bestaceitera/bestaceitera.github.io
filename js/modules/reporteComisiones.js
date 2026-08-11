// Reporte de comisiones. Se separó de los otros reportes de dinero solo por
// tamaño: la lógica de reparto entre varios empleados ocupa lo suyo.
import { renderTable, openModal, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { formatQ, round2, escapeHtml } from '../utils.js';
import { exportButtonsHtml, bindExportButtons } from '../export.js';
import { repartirEntre } from './comisionCore.js';
import { porRango, avisoDeTope } from './reporteCore.js';

async function renderComisiones(el) {
  let preset = 'mes';
  let range = applyRangePreset(preset);

  async function draw() {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    // Solo se piden los registros del período elegido, no todo el historial.
    const [sales, orders, invMovs] = await Promise.all([
      porRango('sales', range),
      porRango('serviceOrders', range),
      porRango('inventoryMovements', range, { max: 3000 }),
    ]);
    const agg = {}; // nombre -> { nombre, ventas, servicios, totalVendido, porPct }

    function acumular(nombre, tipo, detalle, monto, pct) {
      const a = agg[nombre] = agg[nombre] || { nombre, ventas: [], servicios: [], totalVendido: 0, porPct: {} };
      a[tipo].push(detalle);
      a.totalVendido = round2(a.totalVendido + monto);
      a.porPct[pct] = round2((a.porPct[pct] || 0) + monto);
    }

    const ventasPeriodo = sales;
    const ordenesPeriodo = orders;
    const totalVentas = round2(ventasPeriodo.reduce((s, v) => s + v.total, 0));
    const totalServicios = round2(ordenesPeriodo.reduce((s, o) => s + o.total, 0));
    const totalNegocio = round2(totalVentas + totalServicios);

    ventasPeriodo.forEach((s) => {
      const emps = s.empleadosComision || [];
      if (!emps.length) return;
      const partes = repartirEntre(s.total, emps.length);
      emps.forEach((e, i) => acumular(e.empleadoNombre, 'ventas',
        { numero: s.numero, fecha: s.fecha, total: s.total, parte: partes[i], compartida: emps.length },
        partes[i], Number(e.comisionPct) || 0));
    });
    ordenesPeriodo.forEach((o) => {
      const emps = o.empleados || [];
      if (!emps.length) return;
      const partes = repartirEntre(o.total, emps.length);
      emps.forEach((e, i) => acumular(e.empleadoNombre, 'servicios',
        { numero: o.numero, fecha: o.fecha, total: o.total, parte: partes[i], compartida: emps.length },
        partes[i], Number(e.comisionPct) || 0));
    });

    // La comisión se aplica al TOTAL acumulado del período, no a cada venta.
    Object.values(agg).forEach((a) => {
      a.comision = round2(Object.entries(a.porPct).reduce((s, [pct, monto]) => s + (monto * Number(pct)) / 100, 0));
      const pcts = Object.keys(a.porPct).map(Number);
      a.pctLabel = pcts.length === 1 ? `${pcts[0]}%` : 'varios %';
    });

    const sorted = Object.values(agg).sort((a, b) => b.totalVendido - a.totalVendido);
    const sumaDesglose = round2(sorted.reduce((s, r) => s + r.totalVendido, 0));
    const sinAsignar = round2(totalNegocio - sumaDesglose);
    const totalComisiones = round2(sorted.reduce((s, r) => s + r.comision, 0));

    // Productos que salieron para uso propio: NO son venta ni generan comisión.
    const usoPropio = invMovs.filter((m) => m.motivo === 'uso propio');
    const rows = sorted.map((r) => ({
      nombre: r.nombre,
      ventas: r.ventas.length,
      servicios: r.servicios.length,
      vendido: formatQ(r.totalVendido),
      pct: r.pctLabel,
      comision: formatQ(r.comision),
    }));
    const cols = [
      { key: 'nombre', label: 'Empleado' },
      { key: 'ventas', label: 'Ventas' },
      { key: 'servicios', label: 'Servicios' },
      { key: 'vendido', label: 'Vendió en el período' },
      { key: 'pct', label: '%' },
      { key: 'comision', label: 'Comisión a pagar' },
      { key: 'detalle', label: '', format: (r) => `<button class="btn btn-secondary btn-sm" data-emp="${escapeHtml(r.nombre)}">Ver detalle</button>` },
    ];

    el.innerHTML = `
      <div class="toolbar">${dateRangePresetButtons()}<div class="spacer"></div>${exportButtonsHtml()}</div>
      ${avisoDeTope(sales, orders, invMovs)}
      <p class="text-muted mt-16" style="margin-bottom:8px">Período: <b>${range.from}</b> a <b>${range.to}</b></p>
      <div class="grid grid-4">
        <div class="stat-card"><div class="label">Total vendido</div><div class="value">${formatQ(totalNegocio)}</div>
          <div class="sub">${formatQ(totalVentas)} en ventas · ${formatQ(totalServicios)} en servicios</div></div>
        <div class="stat-card"><div class="label">Total comisiones a pagar</div><div class="value">${formatQ(totalComisiones)}</div></div>
        <div class="stat-card"><div class="label">Ventas / órdenes</div><div class="value">${ventasPeriodo.length} / ${ordenesPeriodo.length}</div></div>
        <div class="stat-card"><div class="label">Productos para uso propio</div><div class="value">${usoPropio.reduce((s, m) => s + (Number(m.cantidad) || 0), 0)}</div><div class="sub">unidades — no es venta</div></div>
      </div>

      <div class="section-title">Cuánto vendió cada quien</div>
      <div class="card"><div id="rep-comisiones-table"></div></div>
      ${sinAsignar > 0.009 ? `<p class="text-muted" style="font-size:12.5px;margin-top:8px">
          Nota: ${formatQ(sinAsignar)} del total no tiene empleado asignado (ventas registradas antes de exigirlo).</p>` : ''}

      ${usoPropio.length ? `<p class="text-muted mt-16" style="font-size:12.5px">
          En este período también salieron <b>${usoPropio.reduce((s, m) => s + (Number(m.cantidad) || 0), 0)} unidad(es)</b>
          para uso propio, que no son venta ni generan comisión.
          El detalle completo está en la pestaña <b>Uso propio</b>.</p>` : ''}
    `;
    const t = renderTable({ columns: cols, rows, pageSize: 12, emptyMessage: 'Nadie tiene ventas en el período.' });
    const tableContainer = el.querySelector('#rep-comisiones-table');
    tableContainer.innerHTML = t.html;
    t.mount(tableContainer);
    bindExportButtons(el, {
      title: `Ventas y comisiones por empleado (${range.from} a ${range.to})`,
      columns: cols.filter((c) => c.key !== 'detalle'),
      getRows: () => rows,
      filename: 'comisiones',
    });
    tableContainer.addEventListener('click', (e) => {
      const nombre = e.target.dataset.emp;
      if (nombre) showEmployeeDetail(agg[nombre]);
    });
    bindRangeControls(el, (r, p) => { range = r; preset = p; draw(); }, { activo: preset });
  }

  function showEmployeeDetail(r) {
    const filas = (tipo, list) => list.length
      ? list.map((it) => `<tr>
          <td>${escapeHtml(it.numero)}</td><td>${escapeHtml(it.fecha)}</td>
          <td>${formatQ(it.total)}</td>
          <td>${it.compartida > 1 ? `<span class="badge badge-info">entre ${it.compartida}</span>` : ''}</td>
          <td>${formatQ(it.parte)}</td>
        </tr>`).join('')
      : `<tr><td colspan="5" class="table-empty">Sin ${tipo} en el período.</td></tr>`;
    const detallePct = Object.entries(r.porPct)
      .map(([pct, monto]) => `${formatQ(monto)} × ${Number(pct)}% = <b>${formatQ(round2(monto * Number(pct) / 100))}</b>`)
      .join('<br>');
    openModal(`${r.nombre} — ventas del período`, `
      <div class="section-title" style="margin-top:0">Ventas</div>
      <div class="table-wrap"><table>
        <thead><tr><th>No.</th><th>Fecha</th><th>Total venta</th><th>Compartida</th><th>Le cuenta</th></tr></thead>
        <tbody>${filas('ventas', r.ventas)}</tbody>
      </table></div>
      <div class="section-title">Servicios</div>
      <div class="table-wrap"><table>
        <thead><tr><th>No.</th><th>Fecha</th><th>Total orden</th><th>Compartida</th><th>Le cuenta</th></tr></thead>
        <tbody>${filas('servicios', r.servicios)}</tbody>
      </table></div>
      <div class="card mt-16" style="background:var(--primary-light);border-color:var(--primary)">
        <div><b>Vendió en el período: ${formatQ(r.totalVendido)}</b></div>
        <div class="mt-16">Comisión sobre ese total:<br>${detallePct}</div>
        <div class="mt-16" style="font-size:17px"><b>Total a pagar: ${formatQ(r.comision)}</b></div>
      </div>
    `);
  }

  draw();
}

export { renderComisiones };
