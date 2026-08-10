// Los cinco reportes de dinero: comprobantes, bancos, uso propio, cuadre de caja
// y comisiones. Viven aparte de reportes.js porque ese archivo se estaba pasando
// de largo y estos cinco no dependen de los otros: cada uno recibe su contenedor
// y se dibuja solo.
//
// El período elegido se guarda a nivel de módulo, así que al volver a Reportes
// sigue puesto el mismo — igual que en Ventas o Inventario.
import { getByDateRange } from '../data.js';
import { renderTable, openModal, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { formatQ, round2, escapeHtml, formatDateLong } from '../utils.js';
import { exportButtonsHtml, bindExportButtons } from '../export.js';
import { cuadrarPorDia } from './cuadreCore.js';

/** Trae solo los registros del período pedido. Se apoya en la consulta por rango
 *  de data.js para no repetir aquí la misma construcción de filtros. */
async function porRango(coleccion, rango, { max = 5000 } = {}) {
  // El tope va explícito: los reportes miran períodos largos, así que necesitan
  // un margen mayor que el de las pantallas de operación.
  const { filas } = await getByDateRange(coleccion, rango, { max });
  return filas;
}

let presetComp = 'mes';
let soloPendientes = false;

async function renderComprobantes(el) {
  let range = applyRangePreset(presetComp);

  async function draw() {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const depositos = await porRango('deposits', range, { max: 500 });
    const conFoto = depositos.filter((d) => d.fotoBase64);
    const sinFoto = depositos.filter((d) => !d.fotoBase64);
    const montoSinFoto = round2(sinFoto.reduce((s, d) => s + (Number(d.monto) || 0), 0));

    const lista = soloPendientes ? sinFoto : depositos;

    el.innerHTML = `
      <div class="toolbar">${dateRangePresetButtons({ conAyer: true })}</div>
      <div class="grid grid-3 mt-16">
        <div class="stat-card"><div class="label">Depósitos del período</div><div class="value">${depositos.length}</div>
          <div class="sub">${formatQ(round2(depositos.reduce((s, d) => s + (Number(d.monto) || 0), 0)))}</div></div>
        <div class="stat-card"><div class="label">Con su boleta</div>
          <div class="value" style="color:var(--success)">${conFoto.length}</div></div>
        <div class="stat-card"${sinFoto.length ? ' style="border-color:var(--danger);background:var(--danger-light)"' : ''}>
          <div class="label">Falta la boleta</div>
          <div class="value"${sinFoto.length ? ' style="color:var(--danger)"' : ''}>${sinFoto.length}</div>
          ${sinFoto.length ? `<div class="sub">${formatQ(montoSinFoto)} sin respaldo</div>` : ''}</div>
      </div>
      <div class="toolbar mt-16">
        <button class="btn btn-sm ${soloPendientes ? 'btn-secondary' : 'btn-primary'}" data-filtro="todos">Todos</button>
        <button class="btn btn-sm ${soloPendientes ? 'btn-primary' : 'btn-secondary'}" data-filtro="pendientes">
          Solo los que falta boleta${sinFoto.length ? ` (${sinFoto.length})` : ''}
        </button>
      </div>
      ${lista.length ? `<div class="comprobantes-grid mt-16">
        ${lista.map((d) => `
          <div class="comprobante${d.fotoBase64 ? '' : ' sin-foto'}">
            ${d.fotoBase64
              ? `<img src="${d.fotoBase64}" alt="Boleta" data-ver="${d.id}">`
              : `<div class="comprobante-vacio">Sin boleta</div>`}
            <div class="comprobante-datos">
              <b>${formatQ(d.monto)}</b>
              <span>${escapeHtml(formatDateLong(d.fecha))}</span>
              <span class="text-muted">${escapeHtml(d.banco || '')}${d.boleta ? ` · No. ${escapeHtml(d.boleta)}` : ''}</span>
              <span class="text-muted" style="font-size:11.5px">${escapeHtml(d.usuarioNombre || '')}</span>
            </div>
          </div>`).join('')}
      </div>`
      : `<div class="empty-state mt-16">${soloPendientes
          ? 'Todos los depósitos del período tienen su boleta. ✓'
          : 'No hubo depósitos en estas fechas.'}</div>`}
    `;

    el.querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => {
      soloPendientes = b.dataset.filtro === 'pendientes';
      draw();
    }));
    // Tocar la foto la abre grande, que es como se lee un número de boleta.
    el.querySelectorAll('[data-ver]').forEach((img) => img.addEventListener('click', () => {
      const d = depositos.find((x) => x.id === img.dataset.ver);
      openModal(`Boleta — ${d.banco || ''} · ${formatQ(d.monto)}`, `
        <img src="${d.fotoBase64}" class="photo-preview" style="max-width:100%">
        <p class="mt-16">${escapeHtml(formatDateLong(d.fecha))}${d.boleta ? ` · Boleta No. ${escapeHtml(d.boleta)}` : ''}</p>
        ${d.observaciones ? `<p class="text-muted">${escapeHtml(d.observaciones)}</p>` : ''}
      `);
    }));
    bindRangeControls(el, (r, preset) => { range = r; presetComp = preset; draw(); }, { activo: presetComp });
  }
  await draw();
}

// ---------------- Bancos ----------------
/**
 * Dinero que NO pasó por la caja: lo que entró por transferencia y lo que se
 * llevó al banco. Como el efectivo tiene su propio cuadre, esto es lo único que
 * dice cuánto hay en cada cuenta y de dónde salió.
 */
let presetBancos = 'mes';

async function renderBancos(el) {
  let range = applyRangePreset(presetBancos);

  async function draw() {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const [ventas, ordenes, depositos] = await Promise.all([
      porRango('sales', range, { max: 4000 }),
      porRango('serviceOrders', range, { max: 3000 }),
      porRango('deposits', range, { max: 1000 }),
    ]);

    // Lo que entró por transferencia, venga de una venta o de una orden.
    const entradas = [
      ...ventas.filter((v) => v.bancoNombre).map((v) => ({
        fecha: v.fecha, banco: v.bancoNombre, cuenta: v.bancoCuenta || '', concepto: `Venta ${v.numero}`,
        cliente: v.clienteNombre || '', monto: Number(v.total) || 0 })),
      ...ordenes.filter((o) => o.bancoNombre).map((o) => ({
        fecha: o.fecha, banco: o.bancoNombre, cuenta: o.bancoCuenta || '', concepto: `Orden ${o.numero}`,
        cliente: o.clienteNombre || '', monto: Number(o.total) || 0 })),
    ].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));

    // Se agrupa por CUENTA, no solo por banco: dos cuentas del mismo banco son
    // dinero en lugares distintos y sumarlas juntas escondería eso.
    const porBanco = {};
    const anota = (banco, cuenta, campo, monto) => {
      const clave = `${banco}|${cuenta || ''}`;
      porBanco[clave] = porBanco[clave] || { banco, cuenta: cuenta || '', recibido: 0, depositado: 0 };
      porBanco[clave][campo] = round2(porBanco[clave][campo] + monto);
    };
    entradas.forEach((e) => anota(e.banco, e.cuenta, 'recibido', e.monto));
    depositos.forEach((d) => anota(d.banco || 'Sin banco', d.bancoCuenta, 'depositado', Number(d.monto) || 0));

    const bancos = Object.values(porBanco)
      .map((b) => ({ ...b, total: round2(b.recibido + b.depositado) }))
      .sort((a, b) => b.total - a.total);

    const totalRecibido = round2(entradas.reduce((s, e) => s + e.monto, 0));
    const totalDepositado = round2(depositos.reduce((s, d) => s + (Number(d.monto) || 0), 0));

    const rows = entradas.map((e) => ({
      fecha: e.fecha, banco: e.banco, cuenta: e.cuenta || '—', concepto: e.concepto,
      cliente: e.cliente, monto: formatQ(e.monto),
    }));
    const cols = [
      { key: 'fecha', label: 'Fecha' },
      { key: 'banco', label: 'Banco' },
      { key: 'cuenta', label: 'No. de cuenta' },
      { key: 'concepto', label: 'Concepto' },
      { key: 'cliente', label: 'Cliente' },
      { key: 'monto', label: 'Monto' },
    ];

    el.innerHTML = `
      <div class="toolbar">${dateRangePresetButtons({ conAyer: true })}<div class="spacer"></div>${exportButtonsHtml()}</div>
      <div class="grid grid-3 mt-16">
        <div class="stat-card" style="border-color:var(--primary);background:var(--primary-light)">
          <div class="label">Recibido por transferencia</div><div class="value">${formatQ(totalRecibido)}</div>
          <div class="sub">${entradas.length} cobro${entradas.length === 1 ? '' : 's'} — no pasó por la caja</div></div>
        <div class="stat-card"><div class="label">Depositado en efectivo</div><div class="value">${formatQ(totalDepositado)}</div>
          <div class="sub">${depositos.length} depósito${depositos.length === 1 ? '' : 's'}</div></div>
        <div class="stat-card"><div class="label">Entró al banco en total</div>
          <div class="value">${formatQ(round2(totalRecibido + totalDepositado))}</div></div>
      </div>
      <div class="periodo-resumen mt-16">
        <span>Del ${escapeHtml(range.from)} al ${escapeHtml(range.to)}</span>
        <span>Dinero que no está en el cajón</span>
      </div>
      ${bancos.length ? `<div class="section-title">Cuánto entró a cada banco</div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Cuenta</th><th>Por transferencia</th><th>Por depósito</th><th>Total</th></tr></thead>
        <tbody>${bancos.map((b) => `<tr>
          <td><b>${escapeHtml(b.banco)}</b>${b.cuenta ? `<br><span class="num-cuenta">${escapeHtml(b.cuenta)}</span>` : ''}</td>
          <td>${formatQ(b.recibido)}</td>
          <td>${formatQ(b.depositado)}</td><td><b>${formatQ(b.total)}</b></td></tr>`).join('')}</tbody>
      </table></div></div>` : ''}
      <div class="section-title">Cobros por transferencia</div>
      <div class="card"><div id="rep-bancos-table"></div></div>
    `;

    const t = renderTable({ columns: cols, rows, pageSize: 15,
      emptyMessage: 'No hubo cobros por transferencia en estas fechas.' });
    const cont = el.querySelector('#rep-bancos-table');
    cont.innerHTML = t.html;
    t.mount(cont);
    bindExportButtons(el, { title: 'Cobros por transferencia', columns: cols, getRows: () => rows, filename: 'bancos' });
    bindRangeControls(el, (r, preset) => { range = r; presetBancos = preset; draw(); }, { activo: presetBancos });
  }
  await draw();
}

// ---------------- Uso propio ----------------
/**
 * Producto que salió del inventario sin venderse. No es venta, no entra a la
 * caja y no genera comisión: es costo puro, y por eso conviene poder verlo
 * aparte, con su total en quetzales y exportable, no escondido dentro de otro
 * reporte.
 */
let presetUso = 'mes';

async function renderUsoPropio(el) {
  let range = applyRangePreset(presetUso);

  async function draw() {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const movs = (await porRango('inventoryMovements', range, { max: 3000 }))
      .filter((m) => m.motivo === 'uso propio');

    const costoDe = (m) => round2((Number(m.costoUnitario) || 0) * (Number(m.cantidad) || 0));
    const totalUnidades = movs.reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
    const totalCosto = round2(movs.reduce((s, m) => s + costoDe(m), 0));

    // Cuánto sacó cada persona, para saber a quién preguntarle si algo no cuadra.
    const porPersona = {};
    movs.forEach((m) => {
      const quien = m.usuarioNombre || 'Sin nombre';
      porPersona[quien] = porPersona[quien] || { nombre: quien, unidades: 0, costo: 0 };
      porPersona[quien].unidades += Number(m.cantidad) || 0;
      porPersona[quien].costo = round2(porPersona[quien].costo + costoDe(m));
    });
    const personas = Object.values(porPersona).sort((a, b) => b.unidades - a.unidades);

    const rows = movs.map((m) => ({
      fecha: m.fecha || '',
      producto: m.productoNombre || '',
      cantidad: m.cantidad,
      costo: formatQ(costoDe(m)),
      responsable: m.usuarioNombre || '',
      nota: m.nota || '',
      catalogo: m.productoId ? 'Sí' : 'No (suelto)',
    }));
    const cols = [
      { key: 'fecha', label: 'Fecha' },
      { key: 'producto', label: 'Producto' },
      { key: 'cantidad', label: 'Cantidad' },
      { key: 'costo', label: 'Costo' },
      { key: 'responsable', label: 'Quién lo sacó' },
      { key: 'catalogo', label: 'En catálogo' },
      { key: 'nota', label: '¿Para qué?' },
    ];

    el.innerHTML = `
      <div class="toolbar">${dateRangePresetButtons({ conAyer: true })}<div class="spacer"></div>${exportButtonsHtml()}</div>
      <div class="grid grid-3 mt-16">
        <div class="stat-card"><div class="label">Unidades que salieron</div><div class="value">${totalUnidades}</div>
          <div class="sub">${movs.length === 1 ? '1 salida registrada' : `${movs.length} salidas registradas`}</div></div>
        <div class="stat-card" style="border-color:var(--primary);background:var(--primary-light)">
          <div class="label">Costo de lo que salió</div><div class="value">${formatQ(totalCosto)}</div>
          <div class="sub">no se cobró — es costo del negocio</div></div>
        <div class="stat-card"><div class="label">Personas</div><div class="value">${personas.length}</div></div>
      </div>
      <div class="periodo-resumen mt-16">
        <span>Del ${escapeHtml(range.from)} al ${escapeHtml(range.to)}</span>
        <span>No es venta · no entra a la caja · no genera comisión</span>
      </div>
      ${personas.length ? `<div class="section-title">Cuánto sacó cada quien</div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Persona</th><th>Unidades</th><th>Costo</th></tr></thead>
        <tbody>${personas.map((p) => `<tr><td>${escapeHtml(p.nombre)}</td><td>${p.unidades}</td><td>${formatQ(p.costo)}</td></tr>`).join('')}</tbody>
      </table></div></div>` : ''}
      <div class="section-title">Detalle de cada salida</div>
      <div class="card"><div id="rep-uso-table"></div></div>
    `;

    const t = renderTable({ columns: cols, rows, pageSize: 15,
      emptyMessage: 'No hubo salidas por uso propio en estas fechas.' });
    const cont = el.querySelector('#rep-uso-table');
    cont.innerHTML = t.html;
    t.mount(cont);
    bindExportButtons(el, { title: 'Productos para uso propio', columns: cols, getRows: () => rows, filename: 'uso_propio' });
    bindRangeControls(el, (r, preset) => { range = r; presetUso = preset; draw(); }, { activo: presetUso });
  }
  await draw();
}

// ---------------- Caja: cuadre día por día ----------------
let presetCaja = 'mes';

async function renderCaja(el) {
  let range = applyRangePreset(presetCaja);

  async function draw() {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const [movimientos, deposits] = await Promise.all([
      porRango('cashMovements', range, { max: 4000 }),
      porRango('deposits', range, { max: 1000 }),
    ]);
    const dias = cuadrarPorDia(movimientos);
    const totalDepositar = round2(dias.reduce((s, d) => s + d.aDepositar, 0));
    const totalVendido = round2(dias.reduce((s, d) => s + d.totalEntradas, 0));
    const totalDepositado = round2(dias.reduce((s, d) => s + d.depositado, 0));

    const rows = dias.map((d) => ({
      fecha: d.fecha,
      dia: formatDateLong(d.fecha),
      entradas: formatQ(d.totalEntradas),
      salidas: formatQ(round2(d.totalSalidas - d.depositado)),
      depositado: formatQ(d.depositado),
      aDepositar: formatQ(d.aDepositar),
    }));
    const cols = [
      { key: 'dia', label: 'Día' },
      { key: 'entradas', label: 'Entró en efectivo' },
      { key: 'salidas', label: 'Salidas' },
      { key: 'depositado', label: 'Ya depositado' },
      // Es el número por el que se abre este reporte: va resaltado.
      { key: 'aDepositar', label: 'A depositar', format: (r) => `<b style="color:var(--primary)">${escapeHtml(r.aDepositar)}</b>` },
    ];

    const depositRows = deposits.map((d) => ({ fecha: d.fecha, banco: d.banco, boleta: d.boleta, monto: formatQ(d.monto), usuario: d.usuarioNombre }));
    const depositCols = [{ key: 'fecha', label: 'Fecha' }, { key: 'banco', label: 'Banco' }, { key: 'boleta', label: 'Boleta' }, { key: 'monto', label: 'Monto' }, { key: 'usuario', label: 'Usuario' }];

    el.innerHTML = `
      <div class="toolbar">${dateRangePresetButtons({ conAyer: true })}<div class="spacer"></div>${exportButtonsHtml()}</div>
      <div class="grid grid-3 mt-16">
        <div class="stat-card"><div class="label">Entró en efectivo</div><div class="value">${formatQ(totalVendido)}</div></div>
        <div class="stat-card"><div class="label">Ya depositado</div><div class="value">${formatQ(totalDepositado)}</div></div>
        <div class="stat-card" style="border-color:var(--primary);background:var(--primary-light)">
          <div class="label">Falta depositar</div><div class="value">${formatQ(totalDepositar)}</div></div>
      </div>
      <div class="periodo-resumen mt-16">
        <span>Del ${escapeHtml(range.from)} al ${escapeHtml(range.to)}</span>
        <span>${dias.length} día${dias.length === 1 ? '' : 's'} con movimiento</span>
      </div>
      <div class="card mt-16"><div id="rep-caja-dias"></div></div>
      <div class="section-title">Depósitos bancarios realizados</div>
      <div class="card"><div class="toolbar">${exportButtonsHtml()}</div><div id="rep-caja-deposits"></div></div>
    `;

    const t1 = renderTable({ columns: cols, rows, pageSize: 15, emptyMessage: 'No hubo movimiento de caja en estas fechas.' });
    const cont = el.querySelector('#rep-caja-dias');
    cont.innerHTML = t1.html;
    t1.mount(cont);
    bindExportButtons(el, { title: 'Cuadre diario de caja', columns: cols, getRows: () => rows, filename: 'cuadre_diario' });

    const t2 = renderTable({ columns: depositCols, rows: depositRows, pageSize: 10, emptyMessage: 'Sin depósitos registrados en estas fechas.' });
    const dep = el.querySelector('#rep-caja-deposits');
    dep.innerHTML = t2.html;
    t2.mount(dep);
    bindExportButtons(dep.closest('.card'), { title: 'Depósitos bancarios', columns: depositCols, getRows: () => depositRows, filename: 'depositos_bancarios' });

    bindRangeControls(el, (r, preset) => { range = r; presetCaja = preset; draw(); }, { activo: presetCaja });
  }
  await draw();
}

// ---------------- Cierre del período: ventas por empleado y comisiones ----------------
// La comisión NO se calcula venta por venta: primero se acumula cuánto vendió cada
// empleado en todo el período y al final se le aplica su porcentaje a ese total.
// Cuando una venta la hacen varios, se reparte entre ellos, de modo que la suma del
// desglose por empleado da exactamente el total vendido del negocio.
/** Reparte un monto entre n personas sin perder ni un centavo por redondeo. */
export { renderComprobantes, renderBancos, renderUsoPropio, renderCaja };
