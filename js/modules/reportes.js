import { getAll } from '../data.js';
import { renderTable, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { formatQ, round2, escapeHtml } from '../utils.js';
import { exportButtonsHtml, bindExportButtons } from '../export.js';
import { renderComprobantes, renderBancos, renderUsoPropio, renderCaja } from './reportesDinero.js';
import { renderComisiones } from './reporteComisiones.js';
import { renderDiario } from './reporteDiario.js';
import { porRango, avisoDeTope, detalleDe } from './reporteCore.js';
import { resumenPorEmpleado } from './comisionCore.js';

async function render(container) {
  container.innerHTML = `
    <div class="toolbar" style="margin-bottom:0">
      <button class="btn btn-primary btn-sm tab-btn" data-tab="inventario">Inventario</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="ventas">Ventas</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="servicios">Servicios</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="compras">Compras</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="clientes">Clientes</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="caja">Caja</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="diario">Detalle diario</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="comisiones">Comisiones</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="usopropio">Uso propio</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="bancos">Bancos</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="comprobantes">Comprobantes</button>
    </div>
    <div id="rep-content" class="mt-16"></div>
  `;
  const tabButtons = container.querySelectorAll('.tab-btn');
  const content = container.querySelector('#rep-content');
  const renderers = { inventario: renderInventario, ventas: renderVentas, servicios: renderServicios, compras: renderCompras, clientes: renderClientes, caja: renderCaja, diario: renderDiario, comisiones: renderComisiones, usopropio: renderUsoPropio, bancos: renderBancos, comprobantes: renderComprobantes };

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
    const [products, sales] = await Promise.all([
      getAll('products', { order: 'nombre' }),
      getAll('sales', { order: 'fecha', direction: 'desc', max: 5000 }),
    ]);
    const soldQty = {};
    // Los artículos sueltos no tienen productoId, así que no cuentan en el ranking por producto.
    sales.forEach((s) => s.items?.forEach((i) => {
      if (i.productoId) soldQty[i.productoId] = (soldQty[i.productoId] || 0) + i.cantidad;
    }));
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
    el.querySelector('#rep-inv-table').innerHTML = t1.html;
    t1.mount(el.querySelector('#rep-inv-table'));
    bindExportButtons(el.querySelector('#rep-inv-table'), { title: 'Productos más/menos vendidos', columns: cols1, getRows: () => ranked, filename: 'productos_vendidos' });

    const cols2 = [{ key: 'nombre', label: 'Producto' }, { key: 'stock', label: 'Stock' }, { key: 'stockMinimo', label: 'Stock mínimo' }];
    const t2 = renderTable({ columns: cols2, rows: lowStock, pageSize: 12, emptyMessage: 'No hay productos bajo el mínimo.', extraToolbar: exportButtonsHtml() });
    el.querySelector('#rep-inv-low').innerHTML = t2.html;
    t2.mount(el.querySelector('#rep-inv-low'));
    bindExportButtons(el.querySelector('#rep-inv-low'), { title: 'Productos con stock bajo', columns: cols2, getRows: () => lowStock, filename: 'stock_bajo' });
  }

  // ---------------- Ventas ----------------
  async function renderVentas(el) {
    // Abre en el mes en curso y deja marcado el botón del período, igual que
    // Ventas, Caja y los demás reportes. Antes abría en "hoy" SIN marcar ningún
    // botón: el reporte parecía tener solo dos ventas y no había forma de saber
    // qué período se estaba viendo ni qué se estaba exportando.
    let preset = 'mes';
    let range = applyRangePreset(preset);

    async function draw() {
      el.innerHTML = '<div class="empty-state">Cargando…</div>';
      // Se incluyen también las órdenes de servicio: para el dueño "lo vendido"
      // del período es todo lo que entró, no solo el mostrador. Antes el reporte
      // solo traía ventas y el total no cuadraba con el de comisiones.
      const [ventas, ordenes] = await Promise.all([
        porRango('sales', range),
        porRango('serviceOrders', range),
      ]);
      if (!el.isConnected) return;

      const deVenta = (s) => ({
        numero: s.numero, fecha: s.fecha, tipo: 'Venta', cliente: s.clienteNombre || '',
        detalle: detalleDe(s), formaPago: s.formaPago || '', total: formatQ(s.total),
        usuario: (s.empleadosComision || []).map((e) => e.empleadoNombre).join(', ') || '—',
        _orden: `${s.fecha}|${s.numero}`, _monto: Number(s.total) || 0,
      });
      const deOrden = (o) => ({
        numero: o.numero, fecha: o.fecha, tipo: 'Servicio', cliente: o.clienteNombre || '',
        detalle: detalleDe(o), formaPago: o.formaPago || '', total: formatQ(o.total),
        usuario: (o.empleados || []).map((e) => e.empleadoNombre).join(', ') || '—',
        _orden: `${o.fecha}|${o.numero}`, _monto: Number(o.total) || 0,
      });

      const movimientos = [...ventas.map(deVenta), ...ordenes.map(deOrden)]
        .sort((a, b) => (a._orden < b._orden ? 1 : -1));
      const totalQ = round2(movimientos.reduce((s, r) => s + r._monto, 0));
      const totalVentas = round2(ventas.reduce((s, v) => s + (Number(v.total) || 0), 0));
      const totalServicios = round2(ordenes.reduce((s, o) => s + (Number(o.total) || 0), 0));

      const cols = [
        { key: 'numero', label: 'No.' }, { key: 'fecha', label: 'Fecha' }, { key: 'tipo', label: 'Tipo' },
        { key: 'cliente', label: 'Cliente' }, { key: 'detalle', label: 'Qué se vendió' },
        { key: 'formaPago', label: 'Pago' }, { key: 'total', label: 'Total' },
        { key: 'usuario', label: 'Realizada por' },
      ];
      // La fila del total va DENTRO de la tabla para que salga en el PDF y en el
      // Excel: un reporte que se lleva al banco o al contador tiene que traer su
      // propia suma, no obligar a rehacerla a mano.
      const filas = [...movimientos, {
        numero: 'TOTAL', fecha: '', tipo: '', cliente: '',
        detalle: `${ventas.length} venta(s) y ${ordenes.length} servicio(s)`,
        formaPago: '', total: formatQ(totalQ), usuario: '',
      }];

      // Cuánto vendió cada quien y cuánto se le debe, con la MISMA cuenta que usa
      // el reporte de comisiones.
      const empleados = resumenPorEmpleado(ventas, ordenes);
      const totalComisiones = round2(empleados.reduce((s, e) => s + e.comision, 0));
      const colsEmp = [
        { key: 'nombre', label: 'Empleado' }, { key: 'ventas', label: 'Ventas' },
        { key: 'servicios', label: 'Servicios' }, { key: 'vendido', label: 'Vendió' },
        { key: 'pct', label: '%' }, { key: 'comision', label: 'Comisión a pagar' },
      ];
      const filasEmp = [
        ...empleados.map((e) => ({
          nombre: e.nombre, ventas: e.ventas.length, servicios: e.servicios.length,
          vendido: formatQ(e.totalVendido), pct: e.pctLabel, comision: formatQ(e.comision),
        })),
        { nombre: 'TOTAL', ventas: '', servicios: '', vendido: formatQ(round2(empleados.reduce((s, e) => s + e.totalVendido, 0))),
          pct: '', comision: formatQ(totalComisiones) },
      ];

      el.innerHTML = `
        <div class="toolbar">${dateRangePresetButtons()}</div>
        ${avisoDeTope(ventas, ordenes)}
        <div class="grid grid-3 mt-16">
          <div class="stat-card"><div class="label">Total vendido</div><div class="value">${formatQ(totalQ)}</div>
            <div class="sub">${formatQ(totalVentas)} en ventas · ${formatQ(totalServicios)} en servicios</div></div>
          <div class="stat-card"><div class="label">Ventas / servicios</div><div class="value">${ventas.length} / ${ordenes.length}</div></div>
          <div class="stat-card"><div class="label">Comisiones a pagar</div><div class="value">${formatQ(totalComisiones)}</div></div>
        </div>

        <div class="section-title">Qué se vendió</div>
        <div class="card"><div class="toolbar">${exportButtonsHtml()}</div><div id="rep-ventas-table"></div></div>

        <div class="section-title">Cuánto vendió cada quien y su comisión</div>
        <div class="card"><div class="toolbar">${exportButtonsHtml()}</div><div id="rep-ventas-emp"></div></div>
      `;

      const marcarTotal = (f) => (f.numero === 'TOTAL' || f.nombre === 'TOTAL' ? 'fila-total' : '');
      const t = renderTable({ columns: cols, rows: filas, searchKeys: ['numero', 'cliente', 'detalle', 'usuario'],
        pageSize: 25, emptyMessage: 'Sin ventas ni servicios en el período.', rowClass: marcarTotal });
      const contVentas = el.querySelector('#rep-ventas-table');
      contVentas.innerHTML = t.html;
      t.mount(contVentas);

      const tEmp = renderTable({ columns: colsEmp, rows: filasEmp, pageSize: 20,
        emptyMessage: 'Nadie tiene ventas en el período.', rowClass: marcarTotal });
      const contEmp = el.querySelector('#rep-ventas-emp');
      contEmp.innerHTML = tEmp.html;
      tEmp.mount(contEmp);

      bindExportButtons(contVentas.closest('.card'), {
        title: `Ventas y servicios (${range.from} a ${range.to})`,
        columns: cols, getRows: () => filas, filename: 'reporte_ventas',
      });
      bindExportButtons(contEmp.closest('.card'), {
        title: `Comisiones por empleado (${range.from} a ${range.to})`,
        columns: colsEmp, getRows: () => filasEmp, filename: 'reporte_ventas_comisiones',
      });
      bindRangeControls(el, (r, p) => { range = r; preset = p; draw(); }, { activo: preset });
    }
    await draw();
  }

  // ---------------- Servicios ----------------
  async function renderServicios(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const orders = await getAll('serviceOrders', { order: 'fecha', direction: 'desc', max: 3000 });
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
    el.querySelector('#rep-serv-table').innerHTML = t.html;
    t.mount(el.querySelector('#rep-serv-table'));
    bindExportButtons(el, { title: 'Servicios más realizados', columns: cols, getRows: () => rows, filename: 'reporte_servicios' });
  }

  // ---------------- Compras ----------------
  async function renderCompras(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const [purchases, suppliers] = await Promise.all([getAll('purchases', { order: 'fecha', direction: 'desc', max: 2000 }), getAll('suppliers')]);
    let proveedorFiltro = '';

    function draw() {
      const rows = purchases.filter((p) => !proveedorFiltro || p.proveedorId === proveedorFiltro)
        .map((p) => ({ numero: p.numero, fecha: p.fecha, proveedor: p.proveedorNombre, total: formatQ(p.total), usuario: p.usuarioNombre }));
      const cols = [{ key: 'numero', label: 'No.' }, { key: 'fecha', label: 'Fecha' }, { key: 'proveedor', label: 'Proveedor' }, { key: 'total', label: 'Total' }, { key: 'usuario', label: 'Usuario' }];
      el.innerHTML = `
        <div class="toolbar">
          <select id="rep-compras-prov" style="max-width:260px">
            <option value="">Todos los proveedores</option>
            ${suppliers.map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === proveedorFiltro ? 'selected' : ''}>${escapeHtml(s.empresa || '')}</option>`).join('')}
          </select>
          <div class="spacer"></div>${exportButtonsHtml()}
        </div>
        <div class="card mt-16"><div id="rep-compras-table"></div></div>
      `;
      const t = renderTable({ columns: cols, rows, pageSize: 12, emptyMessage: 'Sin compras registradas.' });
      el.querySelector('#rep-compras-table').innerHTML = t.html;
      t.mount(el.querySelector('#rep-compras-table'));
      bindExportButtons(el, { title: 'Reporte de compras', columns: cols, getRows: () => rows, filename: 'reporte_compras' });
      el.querySelector('#rep-compras-prov').addEventListener('change', (e) => { proveedorFiltro = e.target.value; draw(); });
    }
    draw();
  }

  // ---------------- Clientes ----------------
  async function renderClientes(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const sales = await getAll('sales', { order: 'fecha', direction: 'desc', max: 5000 });
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
    el.querySelector('#rep-cli-table').innerHTML = t.html;
    t.mount(el.querySelector('#rep-cli-table'));
    bindExportButtons(el, { title: 'Clientes facturados / frecuentes', columns: cols, getRows: () => rows, filename: 'reporte_clientes' });
  }

  // ---------------- Comprobantes de depósito ----------------
  /**
   * Las boletas de los depósitos, y sobre todo CUÁLES FALTAN.
   *
   * Registrar un depósito sin foto está permitido a propósito (el dinero ya se
   * depositó, bloquearlo dejaría la caja descuadrada). El control está aquí: esta
   * pantalla lista los que quedaron sin comprobante para ir a tomarles la foto.
   */
}

export default { render };
