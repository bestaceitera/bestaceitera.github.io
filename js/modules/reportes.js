import { getAll } from '../data.js';
import { renderTable, openModal } from '../ui.js';
import { formatQ, todayISO, round2, escapeHtml } from '../utils.js';
import { exportButtonsHtml, bindExportButtons } from '../export.js';

function dateRangePresetButtons() {
  return `
    <button class="btn btn-secondary btn-sm" data-range="hoy">Hoy</button>
    <button class="btn btn-secondary btn-sm" data-range="semana">Esta semana</button>
    <button class="btn btn-secondary btn-sm" data-range="mes">Este mes</button>
    <button class="btn btn-secondary btn-sm" data-range="anio">Este año</button>
    <button class="btn btn-secondary btn-sm" data-range="todo">Todo</button>
  `;
}

function applyRangePreset(range) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (range === 'hoy') return { from: todayISO(), to: todayISO() };
  if (range === 'semana') {
    const day = now.getDay() || 7;
    const monday = new Date(now); monday.setDate(now.getDate() - day + 1);
    return { from: iso(monday), to: todayISO() };
  }
  if (range === 'mes') return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayISO() };
  if (range === 'anio') return { from: iso(new Date(now.getFullYear(), 0, 1)), to: todayISO() };
  return { from: '2000-01-01', to: '2100-01-01' };
}

async function render(container) {
  container.innerHTML = `
    <div class="toolbar" style="margin-bottom:0">
      <button class="btn btn-primary btn-sm tab-btn" data-tab="inventario">Inventario</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="ventas">Ventas</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="servicios">Servicios</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="compras">Compras</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="clientes">Clientes</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="caja">Caja</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="comisiones">Comisiones</button>
    </div>
    <div id="rep-content" class="mt-16"></div>
  `;
  const tabButtons = container.querySelectorAll('.tab-btn');
  const content = container.querySelector('#rep-content');
  const renderers = { inventario: renderInventario, ventas: renderVentas, servicios: renderServicios, compras: renderCompras, clientes: renderClientes, caja: renderCaja, comisiones: renderComisiones };

  function setActiveTab(tab) {
    tabButtons.forEach((b) => {
      const isActive = b.dataset.tab === tab;
      b.classList.toggle('btn-primary', isActive);
      b.classList.toggle('btn-secondary', !isActive);
    });
    renderers[tab](content);
  }
  tabButtons.forEach((b) => b.addEventListener('click', () => setActiveTab(b.dataset.tab)));
  setActiveTab('inventario');

  // ---------------- Inventario ----------------
  async function renderInventario(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const [products, sales] = await Promise.all([getAll('products', { order: 'nombre' }), getAll('sales')]);
    const soldQty = {};
    sales.forEach((s) => s.items?.forEach((i) => { soldQty[i.productoId] = (soldQty[i.productoId] || 0) + i.cantidad; }));
    const ranked = products.map((p) => ({ nombre: p.nombre, vendidos: soldQty[p.id] || 0, stock: p.stock, stockMinimo: p.stockMinimo }))
      .sort((a, b) => b.vendidos - a.vendidos);
    const lowStock = products.filter((p) => Number(p.stock) <= Number(p.stockMinimo ?? 0))
      .map((p) => ({ nombre: p.nombre, stock: p.stock, stockMinimo: p.stockMinimo }));

    el.innerHTML = `
      <div class="section-title" style="margin-top:0">Más y menos vendidos</div>
      <div class="card"><div id="rep-inv-table"></div></div>
      <div class="section-title">Stock bajo el mínimo</div>
      <div class="card"><div id="rep-inv-low"></div></div>
    `;
    const cols1 = [{ key: 'nombre', label: 'Producto' }, { key: 'vendidos', label: 'Unidades vendidas' }, { key: 'stock', label: 'Stock actual' }];
    const t1 = renderTable({ columns: cols1, rows: ranked, pageSize: 12, emptyMessage: 'Sin datos.', extraToolbar: exportButtonsHtml() });
    document.getElementById('rep-inv-table').innerHTML = t1.html;
    t1.mount(document.getElementById('rep-inv-table'));
    bindExportButtons(document.getElementById('rep-inv-table'), { title: 'Productos más/menos vendidos', columns: cols1, getRows: () => ranked, filename: 'productos_vendidos' });

    const cols2 = [{ key: 'nombre', label: 'Producto' }, { key: 'stock', label: 'Stock' }, { key: 'stockMinimo', label: 'Stock mínimo' }];
    const t2 = renderTable({ columns: cols2, rows: lowStock, pageSize: 12, emptyMessage: 'No hay productos bajo el mínimo.', extraToolbar: exportButtonsHtml() });
    document.getElementById('rep-inv-low').innerHTML = t2.html;
    t2.mount(document.getElementById('rep-inv-low'));
    bindExportButtons(document.getElementById('rep-inv-low'), { title: 'Productos con stock bajo', columns: cols2, getRows: () => lowStock, filename: 'stock_bajo' });
  }

  // ---------------- Ventas ----------------
  async function renderVentas(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const allSales = await getAll('sales', { order: 'fecha', direction: 'desc' });
    let range = { from: todayISO(), to: todayISO() };

    function draw() {
      const rows = allSales.filter((s) => s.fecha >= range.from && s.fecha <= range.to)
        .map((s) => ({ numero: s.numero, fecha: s.fecha, cliente: s.clienteNombre, formaPago: s.formaPago, total: formatQ(s.total), usuario: s.usuarioNombre }));
      const totalQ = round2(allSales.filter((s) => s.fecha >= range.from && s.fecha <= range.to).reduce((sum, s) => sum + s.total, 0));
      const cols = [{ key: 'numero', label: 'No.' }, { key: 'fecha', label: 'Fecha' }, { key: 'cliente', label: 'Cliente' }, { key: 'formaPago', label: 'Pago' }, { key: 'total', label: 'Total' }, { key: 'usuario', label: 'Usuario' }];
      el.innerHTML = `
        <div class="toolbar">${dateRangePresetButtons()}<div class="spacer"></div>${exportButtonsHtml()}</div>
        <div class="stat-card mt-16" style="max-width:260px"><div class="label">Total del período</div><div class="value">${formatQ(totalQ)}</div></div>
        <div class="card mt-16"><div id="rep-ventas-table"></div></div>
      `;
      const t = renderTable({ columns: cols, rows, pageSize: 12, emptyMessage: 'Sin ventas en el período.' });
      document.getElementById('rep-ventas-table').innerHTML = t.html;
      t.mount(document.getElementById('rep-ventas-table'));
      bindExportButtons(el, { title: 'Reporte de ventas', columns: cols, getRows: () => rows, filename: 'reporte_ventas' });
      el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { range = applyRangePreset(b.dataset.range); draw(); }));
    }
    draw();
  }

  // ---------------- Servicios ----------------
  async function renderServicios(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const orders = await getAll('serviceOrders');
    const counts = {};
    orders.forEach((o) => o.servicios?.forEach((s) => {
      counts[s.nombre] = counts[s.nombre] || { nombre: s.nombre, veces: 0, total: 0 };
      counts[s.nombre].veces += 1;
      counts[s.nombre].total += s.precio;
    }));
    const rows = Object.values(counts).sort((a, b) => b.veces - a.veces).map((r) => ({ nombre: r.nombre, veces: r.veces, total: formatQ(round2(r.total)) }));
    const cols = [{ key: 'nombre', label: 'Servicio' }, { key: 'veces', label: 'Veces realizado' }, { key: 'total', label: 'Ingresos generados' }];
    el.innerHTML = `<div class="card"><div class="toolbar">${exportButtonsHtml()}</div><div id="rep-serv-table"></div></div>`;
    const t = renderTable({ columns: cols, rows, pageSize: 12, emptyMessage: 'Sin órdenes de servicio registradas.' });
    document.getElementById('rep-serv-table').innerHTML = t.html;
    t.mount(document.getElementById('rep-serv-table'));
    bindExportButtons(el, { title: 'Servicios más realizados', columns: cols, getRows: () => rows, filename: 'reporte_servicios' });
  }

  // ---------------- Compras ----------------
  async function renderCompras(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const [purchases, suppliers] = await Promise.all([getAll('purchases', { order: 'fecha', direction: 'desc' }), getAll('suppliers')]);
    let proveedorFiltro = '';

    function draw() {
      const rows = purchases.filter((p) => !proveedorFiltro || p.proveedorId === proveedorFiltro)
        .map((p) => ({ numero: p.numero, fecha: p.fecha, proveedor: p.proveedorNombre, total: formatQ(p.total), usuario: p.usuarioNombre }));
      const cols = [{ key: 'numero', label: 'No.' }, { key: 'fecha', label: 'Fecha' }, { key: 'proveedor', label: 'Proveedor' }, { key: 'total', label: 'Total' }, { key: 'usuario', label: 'Usuario' }];
      el.innerHTML = `
        <div class="toolbar">
          <select id="rep-compras-prov" style="max-width:260px">
            <option value="">Todos los proveedores</option>
            ${suppliers.map((s) => `<option value="${s.id}" ${s.id === proveedorFiltro ? 'selected' : ''}>${s.empresa}</option>`).join('')}
          </select>
          <div class="spacer"></div>${exportButtonsHtml()}
        </div>
        <div class="card mt-16"><div id="rep-compras-table"></div></div>
      `;
      const t = renderTable({ columns: cols, rows, pageSize: 12, emptyMessage: 'Sin compras registradas.' });
      document.getElementById('rep-compras-table').innerHTML = t.html;
      t.mount(document.getElementById('rep-compras-table'));
      bindExportButtons(el, { title: 'Reporte de compras', columns: cols, getRows: () => rows, filename: 'reporte_compras' });
      document.getElementById('rep-compras-prov').addEventListener('change', (e) => { proveedorFiltro = e.target.value; draw(); });
    }
    draw();
  }

  // ---------------- Clientes ----------------
  async function renderClientes(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const sales = await getAll('sales');
    const agg = {};
    sales.filter((s) => s.clienteTipo === 'registrado').forEach((s) => {
      agg[s.clienteId] = agg[s.clienteId] || { nombre: s.clienteNombre, compras: 0, total: 0 };
      agg[s.clienteId].compras += 1;
      agg[s.clienteId].total += s.total;
    });
    const rows = Object.values(agg).sort((a, b) => b.total - a.total).map((r) => ({ nombre: r.nombre, compras: r.compras, total: formatQ(round2(r.total)) }));
    const cols = [{ key: 'nombre', label: 'Cliente' }, { key: 'compras', label: 'No. compras facturadas' }, { key: 'total', label: 'Total facturado' }];
    el.innerHTML = `<div class="card"><div class="toolbar">${exportButtonsHtml()}</div><div id="rep-cli-table"></div></div>`;
    const t = renderTable({ columns: cols, rows, pageSize: 12, emptyMessage: 'Aún no hay ventas facturadas a clientes registrados.' });
    document.getElementById('rep-cli-table').innerHTML = t.html;
    t.mount(document.getElementById('rep-cli-table'));
    bindExportButtons(el, { title: 'Clientes facturados / frecuentes', columns: cols, getRows: () => rows, filename: 'reporte_clientes' });
  }

  // ---------------- Caja ----------------
  async function renderCaja(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const [closings, deposits, returns] = await Promise.all([
      getAll('cashClosings', { order: 'fecha', direction: 'desc' }),
      getAll('deposits', { order: 'fecha', direction: 'desc' }),
      getAll('cashReturns'),
    ]);
    const pendientes = returns.filter((r) => r.estado === 'pendiente');
    const diferencias = closings.filter((c) => c.estado !== 'cuadrada');

    const closingRows = closings.map((c) => ({ fecha: c.fecha, esperado: formatQ(c.esperado), contado: formatQ(c.contado), diferencia: formatQ(c.diferencia), estado: c.estado, usuario: c.usuarioNombre }));
    const closingCols = [{ key: 'fecha', label: 'Fecha' }, { key: 'esperado', label: 'Esperado' }, { key: 'contado', label: 'Contado' }, { key: 'diferencia', label: 'Diferencia' }, { key: 'estado', label: 'Estado' }, { key: 'usuario', label: 'Usuario' }];

    const depositRows = deposits.map((d) => ({ fecha: d.fecha, banco: d.banco, boleta: d.boleta, monto: formatQ(d.monto), usuario: d.usuarioNombre }));
    const depositCols = [{ key: 'fecha', label: 'Fecha' }, { key: 'banco', label: 'Banco' }, { key: 'boleta', label: 'Boleta' }, { key: 'monto', label: 'Monto' }, { key: 'usuario', label: 'Usuario' }];

    el.innerHTML = `
      <div class="grid grid-3" style="margin-bottom:16px">
        <div class="stat-card"><div class="label">Cuadres con diferencia</div><div class="value" style="color:var(--danger)">${diferencias.length}</div></div>
        <div class="stat-card"><div class="label">Depósitos realizados</div><div class="value">${deposits.length}</div></div>
        <div class="stat-card"><div class="label">Pendiente de devolver</div><div class="value">${formatQ(pendientes.reduce((s, r) => s + r.monto, 0))}</div></div>
      </div>
      <div class="section-title" style="margin-top:0">Arqueo diario (cuadres)</div>
      <div class="card"><div class="toolbar">${exportButtonsHtml()}</div><div id="rep-caja-closings"></div></div>
      <div class="section-title">Depósitos bancarios realizados</div>
      <div class="card"><div class="toolbar">${exportButtonsHtml()}</div><div id="rep-caja-deposits"></div></div>
    `;

    const t1 = renderTable({ columns: closingCols, rows: closingRows, pageSize: 10, emptyMessage: 'Sin cuadres registrados.' });
    const closingsContainer = document.getElementById('rep-caja-closings');
    closingsContainer.innerHTML = t1.html;
    t1.mount(closingsContainer);
    bindExportButtons(closingsContainer.closest('.card'), { title: 'Arqueo diario de caja', columns: closingCols, getRows: () => closingRows, filename: 'arqueo_caja' });

    const t2 = renderTable({ columns: depositCols, rows: depositRows, pageSize: 10, emptyMessage: 'Sin depósitos registrados.' });
    const depositsContainer = document.getElementById('rep-caja-deposits');
    depositsContainer.innerHTML = t2.html;
    t2.mount(depositsContainer);
    bindExportButtons(depositsContainer.closest('.card'), { title: 'Depósitos bancarios', columns: depositCols, getRows: () => depositRows, filename: 'depositos_bancarios' });
  }

  // ---------------- Comisiones (solo administrador) ----------------
  // La comisión de cada empleado en una venta/servicio es: (su % propio × total) ÷ cantidad
  // de empleados asignados a esa misma venta/servicio (si trabajan varios en lo mismo, se
  // reparte entre ellos en vez de que cada uno cobre el 100% de su porcentaje por separado).
  async function renderComisiones(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const [sales, orders] = await Promise.all([getAll('sales'), getAll('serviceOrders')]);
    let range = applyRangePreset('mes');

    function draw() {
      const agg = {}; // nombre -> { nombre, ventas: [...], servicios: [...], comision }
      function addTo(nombre, tipo, detalle) {
        agg[nombre] = agg[nombre] || { nombre, ventas: [], servicios: [], comision: 0 };
        agg[nombre][tipo].push(detalle);
        agg[nombre].comision = round2(agg[nombre].comision + detalle.comision);
      }
      sales.filter((s) => s.fecha >= range.from && s.fecha <= range.to).forEach((s) => {
        const emps = s.empleadosComision || [];
        emps.forEach((e) => {
          const comision = round2((s.total * (e.comisionPct || 0) / 100) / emps.length);
          addTo(e.empleadoNombre, 'ventas', { numero: s.numero, fecha: s.fecha, total: s.total, comision });
        });
      });
      orders.filter((o) => o.fecha >= range.from && o.fecha <= range.to).forEach((o) => {
        const emps = o.empleados || [];
        emps.forEach((e) => {
          const comision = round2((o.total * (e.comisionPct || 0) / 100) / emps.length);
          addTo(e.empleadoNombre, 'servicios', { numero: o.numero, fecha: o.fecha, total: o.total, comision });
        });
      });
      const sorted = Object.values(agg).sort((a, b) => b.comision - a.comision);
      const totalComisiones = round2(sorted.reduce((s, r) => s + r.comision, 0));
      const rows = sorted.map((r) => ({ nombre: r.nombre, ventas: r.ventas.length, servicios: r.servicios.length, comision: formatQ(r.comision) }));
      const cols = [
        { key: 'nombre', label: 'Empleado' },
        { key: 'ventas', label: 'Ventas asignadas' },
        { key: 'servicios', label: 'Servicios asignados' },
        { key: 'comision', label: 'Comisión ganada' },
        { key: 'detalle', label: '', format: (r) => `<button class="btn btn-secondary btn-sm" data-emp="${escapeHtml(r.nombre)}">Ver detalle</button>` },
      ];

      el.innerHTML = `
        <div class="toolbar">${dateRangePresetButtons()}<div class="spacer"></div>${exportButtonsHtml()}</div>
        <div class="stat-card mt-16" style="max-width:260px"><div class="label">Total comisiones del período</div><div class="value">${formatQ(totalComisiones)}</div></div>
        <div class="card mt-16"><div id="rep-comisiones-table"></div></div>
      `;
      const t = renderTable({ columns: cols, rows, pageSize: 12, emptyMessage: 'Sin comisiones en el período.' });
      const tableContainer = document.getElementById('rep-comisiones-table');
      tableContainer.innerHTML = t.html;
      t.mount(tableContainer);
      bindExportButtons(el, {
        title: 'Comisiones por empleado',
        columns: cols.filter((c) => c.key !== 'detalle'),
        getRows: () => rows,
        filename: 'comisiones',
      });
      tableContainer.addEventListener('click', (e) => {
        const nombre = e.target.dataset.emp;
        if (nombre) showEmployeeDetail(agg[nombre]);
      });
      el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { range = applyRangePreset(b.dataset.range); draw(); }));
    }

    function showEmployeeDetail(r) {
      const rowsHtml = (tipo, list) => list.length
        ? list.map((it) => `<tr><td>${escapeHtml(it.numero)}</td><td>${escapeHtml(it.fecha)}</td><td>${formatQ(it.total)}</td><td>${formatQ(it.comision)}</td></tr>`).join('')
        : `<tr><td colspan="4" class="table-empty">Sin ${tipo} en el período.</td></tr>`;
      openModal(`Comisiones — ${r.nombre}`, `
        <div class="section-title" style="margin-top:0">Ventas</div>
        <div class="table-wrap"><table>
          <thead><tr><th>No.</th><th>Fecha</th><th>Total venta</th><th>Comisión</th></tr></thead>
          <tbody>${rowsHtml('ventas', r.ventas)}</tbody>
        </table></div>
        <div class="section-title">Servicios</div>
        <div class="table-wrap"><table>
          <thead><tr><th>No.</th><th>Fecha</th><th>Total orden</th><th>Comisión</th></tr></thead>
          <tbody>${rowsHtml('servicios', r.servicios)}</tbody>
        </table></div>
        <p class="text-right mt-16"><b>Total comisión: ${formatQ(r.comision)}</b></p>
      `);
    }

    draw();
  }
}

export default { render };
