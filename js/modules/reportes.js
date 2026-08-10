import { getAll, getByDateRange } from '../data.js';
import { renderTable, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { formatQ, round2 } from '../utils.js';
import { exportButtonsHtml, bindExportButtons } from '../export.js';
import { renderComprobantes, renderBancos, renderUsoPropio, renderCaja } from './reportesDinero.js';
import { renderComisiones } from './reporteComisiones.js';
import { renderDiario } from './reporteDiario.js';

/**
 * Trae de la base SOLO los registros del período pedido, en vez de descargar la
 * colección entera y filtrar aquí. Es lo que mantiene los reportes rápidos y
 * baratos aunque con los años haya decenas de miles de ventas guardadas.
 */
async function porRango(coleccion, rango, { max = 5000 } = {}) {
  // El tope va explícito: los reportes miran períodos largos, así que necesitan
  // un margen mayor que el de las pantallas de operación.
  const { filas } = await getByDateRange(coleccion, rango, { max });
  return filas;
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
      const ventas = await porRango('sales', range);
      const rows = ventas
        .map((s) => ({ numero: s.numero, fecha: s.fecha, cliente: s.clienteNombre, formaPago: s.formaPago, total: formatQ(s.total),
          usuario: (s.empleadosComision || []).map((e) => e.empleadoNombre).join(', ') || '—' }));
      const totalQ = round2(ventas.reduce((sum, s) => sum + Number(s.total || 0), 0));
      const cols = [{ key: 'numero', label: 'No.' }, { key: 'fecha', label: 'Fecha' }, { key: 'cliente', label: 'Cliente' }, { key: 'formaPago', label: 'Pago' }, { key: 'total', label: 'Total' }, { key: 'usuario', label: 'Realizada por' }];
      el.innerHTML = `
        <div class="toolbar">${dateRangePresetButtons()}<div class="spacer"></div>${exportButtonsHtml()}</div>
        <div class="stat-card mt-16" style="max-width:260px"><div class="label">Total del período</div><div class="value">${formatQ(totalQ)}</div></div>
        <div class="card mt-16"><div id="rep-ventas-table"></div></div>
      `;
      const t = renderTable({ columns: cols, rows, pageSize: 12, emptyMessage: 'Sin ventas en el período.' });
      el.querySelector('#rep-ventas-table').innerHTML = t.html;
      t.mount(el.querySelector('#rep-ventas-table'));
      bindExportButtons(el, { title: 'Reporte de ventas', columns: cols, getRows: () => rows, filename: 'reporte_ventas' });
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
            ${suppliers.map((s) => `<option value="${s.id}" ${s.id === proveedorFiltro ? 'selected' : ''}>${s.empresa}</option>`).join('')}
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
