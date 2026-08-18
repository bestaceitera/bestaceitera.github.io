// Detalle día por día: cada venta con lo que se vendió, quién se la lleva y
// cuánto le toca de comisión, agrupado por día como en la pantalla de Ventas.
//
// El reparto de una venta compartida se hace SOBRE EL TOTAL DE LA VENTA, con la
// misma `repartirEntre` que usa el reporte de comisiones. Repartir producto por
// producto se vería más detallado, pero cada línea redondearía por su cuenta y
// la suma del día terminaría a unos centavos de lo que dice el reporte de
// comisiones: dos reportes del mismo mes con cifras distintas y sin forma de
// saber cuál creer. Por eso el desglose de productos va en su columna, como
// texto, y el dinero se reparte una sola vez por venta.
import { renderTable, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { formatQ, round2, escapeHtml, formatDateLong } from '../utils.js';
import { exportButtonsHtml, bindExportButtons } from '../export.js';
import { repartirEntre, resumenPorEmpleado } from './comisionCore.js';
import { porRango, avisoDeTope, tomarTurno, detalleDe } from './reporteCore.js';

const SIN_ASIGNAR = 'Sin asignar';

/**
 * Convierte ventas y órdenes en una lista plana de operaciones, cada una con su
 * reparto por empleado ya resuelto.
 */
function operaciones(ventas, ordenes) {
  const salida = [];
  const cargar = (registros, campoEmpleados, tipo) => {
    for (const r of registros) {
      const total = Number(r.total) || 0;
      const emps = r[campoEmpleados] || [];
      const porEmpleado = {};
      if (!emps.length) {
        // Ventas de antes de que se exigiera anotar quién vendió: no se pierden,
        // suman al total del día y se muestran aparte, sin generar comisión.
        porEmpleado[SIN_ASIGNAR] = total;
      } else {
        const partes = repartirEntre(total, emps.length);
        emps.forEach((e, i) => {
          const nombre = e.empleadoNombre || '(sin nombre)';
          porEmpleado[nombre] = round2((porEmpleado[nombre] || 0) + partes[i]);
        });
      }
      salida.push({
        fecha: r.fecha || 'sin fecha', numero: r.numero || '', tipo,
        detalle: detalleDe(r), total, porEmpleado,
        hora: r.createdAt?.seconds || 0,
      });
    }
  };
  cargar(ventas, 'empleadosComision', 'venta');
  cargar(ordenes, 'empleados', 'servicio');
  return salida;
}

/** Agrupa las operaciones por día, de la más reciente a la más antigua. */
function porDias(ops) {
  const mapa = new Map();
  for (const o of ops) {
    if (!mapa.has(o.fecha)) mapa.set(o.fecha, { fecha: o.fecha, ops: [], total: 0, porEmpleado: {} });
    const d = mapa.get(o.fecha);
    d.ops.push(o);
    d.total = round2(d.total + o.total);
    for (const [nombre, monto] of Object.entries(o.porEmpleado)) {
      d.porEmpleado[nombre] = round2((d.porEmpleado[nombre] || 0) + monto);
    }
  }
  return [...mapa.values()]
    .map((d) => ({ ...d, ops: d.ops.sort((a, b) => a.hora - b.hora) }))
    .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

async function renderDiario(el) {
  let preset = 'mes';
  let range = applyRangePreset(preset);
  const turno = tomarTurno();

  async function draw() {
    const mio = turno.nuevo();
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const [ventas, ordenes] = await Promise.all([
      porRango('sales', range),
      porRango('serviceOrders', range),
    ]);
    if (!turno.vigente(mio) || !el.isConnected) return;

    const ops = operaciones(ventas, ordenes);
    const dias = porDias(ops);
    // El total y la comisión de cada empleado los da comisionCore, la MISMA
    // función que usan el reporte de ventas y el de comisiones.
    const empleados = resumenPorEmpleado(ventas, ordenes);
    const totalSinAsignar = round2(ops.reduce((s, o) => s + (o.porEmpleado[SIN_ASIGNAR] || 0), 0));
    const haySinAsignar = totalSinAsignar > 0.009;

    // Una columna por empleado, con su % en el encabezado: de un vistazo se ve
    // quién vendió qué y cuánto se le paga, sin abrir otro reporte.
    const columnas = [
      { key: 'dia', label: 'Día / No.' },
      { key: 'detalle', label: 'Qué se vendió' },
      { key: 'total', label: 'Total' },
      ...empleados.map((e) => ({ key: `emp_${e.nombre}`, label: `${e.nombre} (${e.pctLabel})` })),
      ...(haySinAsignar ? [{ key: 'sinAsignar', label: SIN_ASIGNAR }] : []),
    ];

    const fila = (base, montos) => {
      const f = { ...base };
      empleados.forEach((e) => {
        const m = montos?.[e.nombre] || 0;
        f[`emp_${e.nombre}`] = m ? formatQ(m) : '';
      });
      if (haySinAsignar) {
        const m = montos?.[SIN_ASIGNAR] || 0;
        f.sinAsignar = m ? formatQ(m) : '';
      }
      return f;
    };

    // Cada día abre con su renglón de totales y debajo van sus ventas. Así el
    // archivo se lee igual que la pantalla de Ventas: primero el día, luego el
    // detalle de ese día.
    const filas = [];
    for (const d of dias) {
      filas.push(fila({
        dia: formatDateLong(d.fecha, { relativo: false }),
        detalle: `${d.ops.length} ${d.ops.length === 1 ? 'operación' : 'operaciones'}`,
        total: formatQ(d.total),
      }, d.porEmpleado));
      for (const o of d.ops) {
        filas.push(fila({
          dia: `    ${o.numero}`,
          detalle: o.detalle + (o.tipo === 'servicio' ? '  (orden de servicio)' : ''),
          total: formatQ(o.total),
        }, o.porEmpleado));
      }
    }

    const totalPeriodo = round2(dias.reduce((s, d) => s + d.total, 0));
    const totalComisiones = round2(empleados.reduce((s, e) => s + e.comision, 0));

    // Las tres filas de cierre van DENTRO de la tabla para que salgan también en
    // el PDF y en el Excel: un reporte que en pantalla trae los totales y en el
    // archivo no, obliga a rehacer la suma a mano.
    const resumen = (etiqueta, valorTotal, porEmpleado, valorSin) => {
      const f = { dia: etiqueta, detalle: '', total: valorTotal };
      empleados.forEach((e) => { f[`emp_${e.nombre}`] = porEmpleado(e); });
      if (haySinAsignar) f.sinAsignar = valorSin;
      return f;
    };
    filas.push(resumen('TOTAL DEL PERÍODO', formatQ(totalPeriodo), (e) => formatQ(e.totalVendido), formatQ(totalSinAsignar)));
    filas.push(resumen('% de comisión', '', (e) => e.pctLabel, '—'));
    filas.push(resumen('COMISIÓN A PAGAR', formatQ(totalComisiones), (e) => formatQ(e.comision), '—'));

    const CLASES = {
      'TOTAL DEL PERÍODO': 'fila-total', '% de comisión': 'fila-pct', 'COMISIÓN A PAGAR': 'fila-comision',
    };
    const esDia = new Set(dias.map((d) => formatDateLong(d.fecha, { relativo: false })));

    el.innerHTML = `
      <div class="toolbar">${dateRangePresetButtons({ conAyer: true })}</div>
      ${avisoDeTope(ventas, ordenes)}
      <p class="text-muted" style="margin:12px 0 0">Período: <b>${escapeHtml(range.from)}</b> a <b>${escapeHtml(range.to)}</b></p>

      <div class="section-title">Día por día: qué se vendió y quién lo vendió</div>
      <div class="card">
        <div class="toolbar">${exportButtonsHtml()}</div>
        <div id="rd-tabla"></div>
      </div>
      <p class="text-muted" style="font-size:12.5px;margin-top:8px">
        Cada día abre con su total y debajo van sus ventas, con los productos de cada una.
        Cuando una venta la atienden entre varios, el monto <b>se reparte en partes iguales</b> entre ellos,
        igual que en el reporte de comisiones.
        ${haySinAsignar ? `<br>${formatQ(totalSinAsignar)} salen en <b>${SIN_ASIGNAR}</b>: son ventas registradas antes de que
        el sistema pidiera anotar quién vendió, así que no generan comisión para nadie.` : ''}
        <br>Los productos que salieron <b>para uso propio</b> no aparecen: no son venta y están en su propia pestaña.
      </p>
    `;

    const tabla = renderTable({
      columns: columnas, rows: filas, pageSize: 200,
      searchKeys: ['dia', 'detalle'],
      emptyMessage: 'Sin ventas en el período.',
      rowClass: (f) => CLASES[f.dia] || (esDia.has(f.dia) ? 'fila-dia' : ''),
    });
    const cont = el.querySelector('#rd-tabla');
    cont.innerHTML = tabla.html;
    tabla.mount(cont);

    bindExportButtons(cont.closest('.card'), {
      title: `Detalle diario por empleado (${range.from} a ${range.to})`,
      columns: columnas, getRows: () => filas, filename: 'detalle_diario',
    });

    bindRangeControls(el, (r, p) => { range = r; preset = p; draw(); }, { activo: preset });
  }

  await draw();
}

export { renderDiario };
