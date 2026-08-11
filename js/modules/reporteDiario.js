// Detalle día por día: cuánto vendió cada empleado cada día, y qué producto
// salió cada día.
//
// El reparto de una venta compartida es EL MISMO que usa el reporte de
// comisiones (`repartirEntre`): si dos pantallas repartieran distinto, los dos
// reportes darían cifras diferentes para la misma venta y no habría forma de
// saber cuál creer. Por eso la función vive en un solo lugar y las dos la usan.
import { renderTable, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { formatQ, round2, escapeHtml, formatDateLong } from '../utils.js';
import { exportButtonsHtml, bindExportButtons } from '../export.js';
import { repartirEntre } from './comisionCore.js';
import { porRango, avisoDeTope } from './reporteCore.js';

/**
 * Arma la matriz día × empleado.
 *
 * Devuelve además el % de comisión de cada uno y lo que le toca cobrar, porque
 * es la pregunta que sigue siempre después de "¿cuánto vendió?".
 */
function armarMatriz(ventas, ordenes) {
  const dias = new Map();        // fecha -> { fecha, total, porEmpleado: {} }
  const empleados = new Map();   // nombre -> { nombre, total, porPct: {} }

  const anotar = (fecha, nombre, monto, pct) => {
    if (!dias.has(fecha)) dias.set(fecha, { fecha, total: 0, sinAsignar: 0, porEmpleado: {} });
    const d = dias.get(fecha);
    d.porEmpleado[nombre] = round2((d.porEmpleado[nombre] || 0) + monto);
    if (!empleados.has(nombre)) empleados.set(nombre, { nombre, total: 0, porPct: {} });
    const e = empleados.get(nombre);
    e.total = round2(e.total + monto);
    e.porPct[pct] = round2((e.porPct[pct] || 0) + monto);
  };

  const procesar = (registros, campoEmpleados) => {
    for (const r of registros) {
      const fecha = r.fecha || 'sin fecha';
      if (!dias.has(fecha)) dias.set(fecha, { fecha, total: 0, sinAsignar: 0, porEmpleado: {} });
      const d = dias.get(fecha);
      d.total = round2(d.total + (Number(r.total) || 0));
      const emps = r[campoEmpleados] || [];
      // Las ventas viejas, de antes de que se exigiera anotar quién vendió, no
      // se pierden: suman al total del día y se muestran aparte como sin asignar.
      if (!emps.length) { d.sinAsignar = round2(d.sinAsignar + (Number(r.total) || 0)); continue; }
      const partes = repartirEntre(Number(r.total) || 0, emps.length);
      emps.forEach((e, i) => anotar(fecha, e.empleadoNombre || '(sin nombre)', partes[i], Number(e.comisionPct) || 0));
    }
  };
  procesar(ventas, 'empleadosComision');
  procesar(ordenes, 'empleados');

  for (const e of empleados.values()) {
    // La comisión se calcula sobre el total acumulado del período por cada
    // porcentaje, igual que en el reporte de comisiones.
    e.comision = round2(Object.entries(e.porPct).reduce((s, [pct, monto]) => s + (monto * Number(pct)) / 100, 0));
    const pcts = Object.keys(e.porPct).map(Number);
    e.pctLabel = pcts.length === 1 ? `${pcts[0]}%` : 'varios %';
  }

  return {
    dias: [...dias.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
    empleados: [...empleados.values()].sort((a, b) => b.total - a.total),
  };
}

/** Qué producto salió cada día, juntando ventas y productos usados en órdenes. */
function armarProductos(ventas, ordenes) {
  const mapa = new Map();  // fecha|producto -> fila
  const sumar = (fecha, nombre, cantidad, monto, quien, folio) => {
    const clave = `${fecha}|${nombre}`;
    if (!mapa.has(clave)) mapa.set(clave, { fecha, producto: nombre, cantidad: 0, monto: 0, quienes: new Set(), folios: [] });
    const f = mapa.get(clave);
    f.cantidad += Number(cantidad) || 0;
    f.monto = round2(f.monto + (Number(monto) || 0));
    if (quien) quien.split(', ').filter(Boolean).forEach((q) => f.quienes.add(q));
    f.folios.push(folio);
  };

  for (const v of ventas) {
    const quien = (v.empleadosComision || []).map((e) => e.empleadoNombre).filter(Boolean).join(', ');
    for (const i of v.items || []) sumar(v.fecha, i.nombre, i.cantidad, i.subtotal, quien, v.numero);
  }
  for (const o of ordenes) {
    const quien = (o.empleados || []).map((e) => e.empleadoNombre).filter(Boolean).join(', ');
    for (const i of o.productos || []) sumar(o.fecha, i.nombre, i.cantidad, i.subtotal, quien, o.numero);
  }
  return [...mapa.values()]
    .map((f) => ({ ...f, quienes: [...f.quienes].join(', ') || '—' }))
    .sort((a, b) => (a.fecha === b.fecha ? b.monto - a.monto : (a.fecha < b.fecha ? 1 : -1)));
}

async function renderDiario(el) {
  let preset = 'mes';
  let range = applyRangePreset(preset);

  async function draw() {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const [ventas, ordenes] = await Promise.all([
      porRango('sales', range),
      porRango('serviceOrders', range),
    ]);
    if (!el.isConnected) return;

    const { dias, empleados } = armarMatriz(ventas, ordenes);
    const productos = armarProductos(ventas, ordenes);
    const haySinAsignar = dias.some((d) => d.sinAsignar > 0.009);

    // Una columna por empleado, con su % en el encabezado: es lo que pidió el
    // dueño para ver de un vistazo quién vendió qué y cuánto se le paga.
    const colsDias = [
      { key: 'dia', label: 'Día' },
      { key: 'total', label: 'Total vendido' },
      ...empleados.map((e) => ({ key: `emp_${e.nombre}`, label: `${e.nombre} (${e.pctLabel})` })),
      ...(haySinAsignar ? [{ key: 'sinAsignar', label: 'Sin asignar' }] : []),
    ];

    const filaDia = (d) => {
      const fila = { dia: formatDateLong(d.fecha), total: formatQ(d.total) };
      empleados.forEach((e) => { const m = d.porEmpleado[e.nombre] || 0; fila[`emp_${e.nombre}`] = m ? formatQ(m) : '—'; });
      if (haySinAsignar) fila.sinAsignar = d.sinAsignar ? formatQ(d.sinAsignar) : '—';
      return fila;
    };

    const totalPeriodo = round2(dias.reduce((s, d) => s + d.total, 0));
    const totalSinAsignar = round2(dias.reduce((s, d) => s + d.sinAsignar, 0));
    const totalComisiones = round2(empleados.reduce((s, e) => s + e.comision, 0));

    // Las tres filas de cierre van DENTRO de la tabla para que salgan también en
    // el PDF y en el Excel: un reporte que en pantalla trae los totales y en el
    // archivo no, obliga a rehacer la suma a mano.
    const filaResumen = (etiqueta, valorTotal, valorPorEmpleado, valorSin) => {
      const fila = { dia: etiqueta, total: valorTotal };
      empleados.forEach((e) => { fila[`emp_${e.nombre}`] = valorPorEmpleado(e); });
      if (haySinAsignar) fila.sinAsignar = valorSin;
      return fila;
    };
    const RESUMEN = { 'TOTAL DEL PERÍODO': 'fila-total', '% de comisión': 'fila-pct', 'COMISIÓN A PAGAR': 'fila-comision' };
    const filasDias = [
      ...dias.map(filaDia),
      filaResumen('TOTAL DEL PERÍODO', formatQ(totalPeriodo), (e) => formatQ(e.total), formatQ(totalSinAsignar)),
      filaResumen('% de comisión', '', (e) => e.pctLabel, '—'),
      filaResumen('COMISIÓN A PAGAR', formatQ(totalComisiones), (e) => formatQ(e.comision), '—'),
    ];

    const colsProd = [
      { key: 'dia', label: 'Día' },
      { key: 'producto', label: 'Producto' },
      { key: 'cantidad', label: 'Cantidad' },
      { key: 'monto', label: 'Total' },
      { key: 'quienes', label: 'Vendido por' },
      { key: 'folios', label: 'Comprobantes' },
    ];
    const filasProd = productos.map((p) => ({
      dia: formatDateLong(p.fecha), producto: p.producto, cantidad: p.cantidad,
      monto: formatQ(p.monto), quienes: p.quienes, folios: p.folios.join(', '),
    }));
    const unidades = productos.reduce((s, p) => s + p.cantidad, 0);

    el.innerHTML = `
      <div class="toolbar">${dateRangePresetButtons({ conAyer: true })}</div>
      ${avisoDeTope(ventas, ordenes)}
      <p class="text-muted" style="margin:12px 0 0">Período: <b>${escapeHtml(range.from)}</b> a <b>${escapeHtml(range.to)}</b></p>

      <div class="section-title">Qué vendió cada quien, día por día</div>
      <div class="card">
        <div class="toolbar">${exportButtonsHtml()}</div>
        <div id="rd-dias"></div>
      </div>
      ${totalSinAsignar > 0.009 ? `<p class="text-muted" style="font-size:12.5px;margin-top:8px">
        ${formatQ(totalSinAsignar)} salen en <b>Sin asignar</b>: son ventas registradas antes de que
        el sistema pidiera anotar quién vendió, así que no generan comisión para nadie.</p>` : ''}

      <div class="section-title">Qué producto se vendió, día por día</div>
      <div class="card">
        <div class="toolbar">${exportButtonsHtml()}</div>
        <div id="rd-productos"></div>
      </div>
      <p class="text-muted" style="font-size:12.5px;margin-top:8px">
        ${unidades} unidad(es) en total. Incluye los productos usados en órdenes de servicio.
        Los productos que salieron <b>para uso propio</b> no aparecen aquí: no son venta y están en su propia pestaña.</p>
    `;

    const tDias = renderTable({ columns: colsDias, rows: filasDias, pageSize: 40,
      emptyMessage: 'Sin ventas en el período.', rowClass: (f) => RESUMEN[f.dia] || '' });
    const contDias = el.querySelector('#rd-dias');
    contDias.innerHTML = tDias.html;
    tDias.mount(contDias);

    const tProd = renderTable({ columns: colsProd, rows: filasProd, searchKeys: ['producto', 'quienes'], pageSize: 20, emptyMessage: 'Sin productos vendidos en el período.' });
    const contProd = el.querySelector('#rd-productos');
    contProd.innerHTML = tProd.html;
    tProd.mount(contProd);

    // Cada tarjeta lleva sus propios botones, atados a su propia tabla.
    bindExportButtons(contDias.closest('.card'), {
      title: `Ventas por dia y empleado (${range.from} a ${range.to})`,
      columns: colsDias, getRows: () => filasDias, filename: 'detalle_diario_empleados',
    });
    bindExportButtons(contProd.closest('.card'), {
      title: `Productos vendidos por dia (${range.from} a ${range.to})`,
      columns: colsProd, getRows: () => filasProd, filename: 'detalle_diario_productos',
    });

    bindRangeControls(el, (r, p) => { range = r; preset = p; draw(); }, { activo: preset });
  }

  await draw();
}

export { renderDiario };
