import { getAll } from '../data.js';
import { renderTable, openModal, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { formatQ, todayISO, round2, escapeHtml, formatDateLong } from '../utils.js';
import { exportButtonsHtml, bindExportButtons } from '../export.js';

/**
 * Trae de la base SOLO los registros del rango pedido, en vez de descargar la
 * colección entera y filtrar aquí. Es lo que mantiene los reportes rápidos y
 * baratos aunque con los años haya decenas de miles de ventas guardadas.
 * El filtro por rango sobre un solo campo no necesita índices extra en Firestore.
 */
async function porRango(coleccion, { from, to }, { max = 5000 } = {}) {
  const datos = await getAll(coleccion, {
    filters: [['fecha', '>=', from], ['fecha', '<=', to]],
    order: 'fecha', direction: 'desc', max,
  });
  return datos;
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
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="usopropio">Uso propio</button>
    </div>
    <div id="rep-content" class="mt-16"></div>
  `;
  const tabButtons = container.querySelectorAll('.tab-btn');
  const content = container.querySelector('#rep-content');
  const renderers = { inventario: renderInventario, ventas: renderVentas, servicios: renderServicios, compras: renderCompras, clientes: renderClientes, caja: renderCaja, comisiones: renderComisiones, usopropio: renderUsoPropio };

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
    let range = { from: todayISO(), to: todayISO() };

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
      document.getElementById('rep-ventas-table').innerHTML = t.html;
      t.mount(document.getElementById('rep-ventas-table'));
      bindExportButtons(el, { title: 'Reporte de ventas', columns: cols, getRows: () => rows, filename: 'reporte_ventas' });
      bindRangeControls(el, (r) => { range = r; draw(); });
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
    document.getElementById('rep-serv-table').innerHTML = t.html;
    t.mount(document.getElementById('rep-serv-table'));
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
    document.getElementById('rep-cli-table').innerHTML = t.html;
    t.mount(document.getElementById('rep-cli-table'));
    bindExportButtons(el, { title: 'Clientes facturados / frecuentes', columns: cols, getRows: () => rows, filename: 'reporte_clientes' });
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
      const cont = document.getElementById('rep-uso-table');
      cont.innerHTML = t.html;
      t.mount(cont);
      bindExportButtons(el, { title: 'Productos para uso propio', columns: cols, getRows: () => rows, filename: 'uso_propio' });
      bindRangeControls(el, (r, preset) => { range = r; presetUso = preset; draw(); }, { activo: presetUso });
    }
    await draw();
  }

  // ---------------- Caja: cuadre día por día ----------------
  /**
   * Cuánto efectivo se queda en el negocio como caja chica cuando ese día no se
   * registró un fondo inicial. Si sí se registró, manda el monto real de ese día.
   */
  const CAJA_CHICA_POR_DEFECTO = 105;

  const ENTRADAS = ['venta', 'servicio', 'abono', 'otro_ingreso', 'devolucion'];
  const SALIDAS = ['gasto', 'compra', 'vuelto', 'retiro', 'deposito'];

  /**
   * Arma el cuadre de cada día a partir de los movimientos de caja.
   *
   *   efectivo en caja = caja chica + entradas − salidas
   *   a depositar      = efectivo en caja − caja chica
   *
   * La caja chica no se deposita nunca: se queda en el negocio para dar vueltos.
   * Los depósitos que ya se hicieron cuentan como salida, así que "a depositar"
   * siempre muestra lo que TODAVÍA falta llevar al banco, no lo del día entero.
   */
  function cuadrarPorDia(movimientos) {
    const dias = new Map();
    for (const m of movimientos) {
      const dia = m.fecha || '';
      if (!dia) continue;
      if (!dias.has(dia)) dias.set(dia, { fecha: dia, cajaChica: 0, tuvoFondo: false, entradas: 0, salidas: 0, vueltos: 0, depositado: 0, detalle: {} });
      const d = dias.get(dia);
      const monto = Number(m.monto) || 0;
      if (m.categoria === 'fondo_inicial') { d.cajaChica += monto; d.tuvoFondo = true; continue; }
      if (ENTRADAS.includes(m.categoria)) d.entradas += monto;
      else if (SALIDAS.includes(m.categoria)) d.salidas += monto;
      if (m.categoria === 'vuelto') d.vueltos += monto;
      if (m.categoria === 'deposito') d.depositado += monto;
      d.detalle[m.categoria] = round2((d.detalle[m.categoria] || 0) + monto);
    }
    return [...dias.values()]
      .map((d) => {
        const cajaChica = d.tuvoFondo ? round2(d.cajaChica) : CAJA_CHICA_POR_DEFECTO;
        const enCaja = round2(cajaChica + d.entradas - d.salidas);
        // El vuelto no es dinero que entró ni que se gastó: es parte del billete
        // del cliente que se le regresó. Se descuenta de ambos lados para que las
        // columnas coincidan con lo que se cuenta a mano. El total no cambia.
        d.entradas = round2(d.entradas - d.vueltos);
        d.salidas = round2(d.salidas - d.vueltos);
        return { ...d, cajaChica, enCaja, aDepositar: round2(Math.max(0, enCaja - cajaChica)) };
      })
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }

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
      const totalVendido = round2(dias.reduce((s, d) => s + d.entradas, 0));
      const totalDepositado = round2(dias.reduce((s, d) => s + d.depositado, 0));

      const rows = dias.map((d) => ({
        fecha: d.fecha,
        dia: formatDateLong(d.fecha),
        cajaChica: formatQ(d.cajaChica) + (d.tuvoFondo ? '' : ' *'),
        entradas: formatQ(d.entradas),
        salidas: formatQ(round2(d.salidas - d.depositado)),
        depositado: formatQ(d.depositado),
        enCaja: formatQ(d.enCaja),
        aDepositar: formatQ(d.aDepositar),
      }));
      const cols = [
        { key: 'dia', label: 'Día' },
        { key: 'cajaChica', label: 'Caja chica' },
        { key: 'entradas', label: 'Entró en efectivo' },
        { key: 'salidas', label: 'Salidas' },
        { key: 'depositado', label: 'Ya depositado' },
        { key: 'enCaja', label: 'Efectivo en caja' },
        // Es el número por el que se abre este reporte: va resaltado.
        { key: 'aDepositar', label: 'A depositar', format: (r) => `<b style="color:var(--primary)">${escapeHtml(r.aDepositar)}</b>` },
      ];

      const depositRows = deposits.map((d) => ({ fecha: d.fecha, banco: d.banco, boleta: d.boleta, monto: formatQ(d.monto), usuario: d.usuarioNombre }));
      const depositCols = [{ key: 'fecha', label: 'Fecha' }, { key: 'banco', label: 'Banco' }, { key: 'boleta', label: 'Boleta' }, { key: 'monto', label: 'Monto' }, { key: 'usuario', label: 'Usuario' }];

      const hayAsumidos = dias.some((d) => !d.tuvoFondo);

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
        ${hayAsumidos ? `<p class="text-muted">* Ese día no se registró fondo inicial, así que se tomó la caja chica de ${formatQ(CAJA_CHICA_POR_DEFECTO)}.</p>` : ''}
        <div class="section-title">Depósitos bancarios realizados</div>
        <div class="card"><div class="toolbar">${exportButtonsHtml()}</div><div id="rep-caja-deposits"></div></div>
      `;

      const t1 = renderTable({ columns: cols, rows, pageSize: 15, emptyMessage: 'No hubo movimiento de caja en estas fechas.' });
      const cont = document.getElementById('rep-caja-dias');
      cont.innerHTML = t1.html;
      t1.mount(cont);
      bindExportButtons(el, { title: 'Cuadre diario de caja', columns: cols, getRows: () => rows, filename: 'cuadre_diario' });

      const t2 = renderTable({ columns: depositCols, rows: depositRows, pageSize: 10, emptyMessage: 'Sin depósitos registrados en estas fechas.' });
      const dep = document.getElementById('rep-caja-deposits');
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
  function repartir(total, n) {
    const base = Math.floor((total * 100) / n) / 100;
    const partes = new Array(n).fill(base);
    partes[0] = round2(partes[0] + round2(total - base * n));
    return partes;
  }

  async function renderComisiones(el) {
    let range = applyRangePreset('mes');

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
        const partes = repartir(s.total, emps.length);
        emps.forEach((e, i) => acumular(e.empleadoNombre, 'ventas',
          { numero: s.numero, fecha: s.fecha, total: s.total, parte: partes[i], compartida: emps.length },
          partes[i], Number(e.comisionPct) || 0));
      });
      ordenesPeriodo.forEach((o) => {
        const emps = o.empleados || [];
        if (!emps.length) return;
        const partes = repartir(o.total, emps.length);
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
      const tableContainer = document.getElementById('rep-comisiones-table');
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
      bindRangeControls(el, (r) => { range = r; draw(); });
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
}

export default { render };
