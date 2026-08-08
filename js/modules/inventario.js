import { getAll, getByDateRange, addRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, productSearch, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { formatQ, formatDateTime, escapeHtml, round2, todayISO } from '../utils.js';
import { openUsoPropioForm } from './usoPropio.js';
import { getCurrentUser } from '../auth.js';
import { stockBajoHtml, productosBajoMinimo } from './stockBajo.js';

// El período elegido se guarda fuera de render() para que no se pierda cuando la
// pantalla se refresca sola al llegar un cambio desde otro dispositivo.
let rangoGuardado = null;
let presetGuardado = 'mes';

async function render(container) {
  // El historial se pide POR PERÍODO, no "los últimos 400". Así, dentro de años,
  // buscar el uso propio de un mes sigue mostrándolo completo y la pantalla
  // descarga solo ese mes.
  let rango = rangoGuardado || applyRangePreset('mes');
  let tipoActivo = 'todos';
  let movements = [];
  let truncado = false;
  let peticion = 0;

  const products = await getAll('products', { order: 'nombre' });
  const primera = await getByDateRange('inventoryMovements', rango, { max: 1200 });
  movements = primera.filas;
  truncado = primera.truncado;

  // Mismo criterio que el panel de abajo, para que el número y la lista coincidan.
  const lowStock = productosBajoMinimo(products);

  const table = renderTable({
    columns: [
      { key: 'createdAt', label: 'Fecha', format: (r) => formatDateTime(r.createdAt) },
      { key: 'productoNombre', label: 'Producto' },
      { key: 'tipo', label: 'Tipo', format: (r) => r.tipo === 'entrada'
          ? `<span class="badge badge-success">Entrada</span>` : `<span class="badge badge-danger">Salida</span>` },
      { key: 'motivo', label: 'Motivo', format: (r) => r.motivo === 'uso propio'
          ? `<span class="badge badge-info">Uso propio</span>` : escapeHtml(r.motivo || '') },
      { key: 'cantidad', label: 'Cantidad' },
      { key: 'stockResultante', label: 'Stock resultante', format: (r) => r.stockResultante === null || r.stockResultante === undefined ? '<span class="text-muted">—</span>' : r.stockResultante },
      { key: 'usuarioNombre', label: 'Usuario' },
      { key: 'nota', label: 'Nota' },
    ],
    rows: movements,
    searchKeys: ['productoNombre', 'motivo', 'usuarioNombre', 'nota'],
    emptyMessage: 'Aún no hay movimientos de inventario.',
    pageSize: 15,
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-uso-propio">− Salida por uso propio</button>`,
  });

  container.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat-card"><div class="label">Productos activos</div><div class="value">${products.filter((p) => p.estado !== 'inactivo').length}</div></div>
      <div class="stat-card"><div class="label">Stock bajo mínimo</div><div class="value" style="color:var(--danger)">${lowStock.length}</div></div>
      <div class="stat-card"><div class="label">Valor inventario (costo)</div><div class="value">${formatQ(products.reduce((s, p) => s + Number(p.stock || 0) * Number(p.precioCompra || 0), 0))}</div></div>
      <div class="stat-card"><div class="label">Movimientos del período</div><div class="value" id="inv-total-movs">${movements.length}</div></div>
    </div>
    ${stockBajoHtml(products, { max: 60 })}
    <div class="section-title">Entradas y salidas de productos</div>
    <div class="toolbar" id="inv-fechas" style="margin-bottom:10px">${dateRangePresetButtons()}</div>
    <div class="toolbar" id="inv-filtros" style="margin-bottom:10px">
      <button class="btn btn-primary btn-sm" data-mov="todos">Todos</button>
      <button class="btn btn-secondary btn-sm" data-mov="venta">Por ventas</button>
      <button class="btn btn-secondary btn-sm" data-mov="servicio">Por servicios</button>
      <button class="btn btn-secondary btn-sm" data-mov="compra">Por compras</button>
      <button class="btn btn-secondary btn-sm" data-mov="uso propio">Uso propio</button>
    </div>
    <div id="inv-resumen"></div>
    <div class="card" id="inv-kardex-card">${table.html}</div>
  `;
  const card = container.querySelector('#inv-kardex-card');
  const tabla = table.mount(card);
  card.querySelector('#btn-uso-propio').addEventListener('click', () => openUsoPropioForm({ products, onSaved: () => render(container) }));

  // Filtro por tipo de movimiento: sirve sobre todo para revisar de un vistazo
  // qué se sacó para uso propio en vez de buscarlo entre todo lo demás.
  const botonesFiltro = container.querySelectorAll('#inv-filtros [data-mov]');
  function aplicarFiltro(tipo) {
    tipoActivo = tipo;
    botonesFiltro.forEach((b) => {
      const activo = b.dataset.mov === tipo;
      b.classList.toggle('btn-primary', activo);
      b.classList.toggle('btn-secondary', !activo);
    });
    const filas = tipo === 'todos' ? movements : movements.filter((m) => m.motivo === tipo);
    tabla.refresh(filas);
    const unidades = filas.reduce((s, m) => s + (Number(m.cantidad) || 0), 0);
    const esTodo = rango.from <= '2000-01-01';
    const periodo = esTodo ? 'todo el historial' : `del ${rango.from} al ${rango.to}`;
    container.querySelector('#inv-total-movs').textContent = movements.length;
    container.querySelector('#inv-resumen').innerHTML = (tipo === 'todos' ? '' : `
      <div class="periodo-resumen">
        <span>${tipo === 'uso propio' ? 'Productos que salieron para uso propio (no son venta)' : `Movimientos por ${escapeHtml(tipo)}`}
          <span class="text-muted">— ${escapeHtml(periodo)}</span></span>
        <span>${filas.length} movimiento${filas.length === 1 ? '' : 's'} · <b>${unidades} unidad${unidades === 1 ? '' : 'es'}</b></span>
      </div>`)
      + (truncado ? `<div class="alert alert-warning">Este período tiene más de 1,200 movimientos; se muestran los más recientes. Elige un período más corto para verlo completo.</div>` : '');
  }
  botonesFiltro.forEach((b) => b.addEventListener('click', () => aplicarFiltro(b.dataset.mov)));

  // Cambiar de período vuelve a preguntarle a la base solo por esas fechas.
  bindRangeControls(container.querySelector('#inv-fechas'), async (r, preset) => {
    const mio = ++peticion;
    rango = r; rangoGuardado = r; presetGuardado = preset;
    tabla.refresh([]);
    try {
      const res = await getByDateRange('inventoryMovements', rango, { max: 1200 });
      if (mio !== peticion) return;
      movements = res.filas;
      truncado = res.truncado;
    } catch (err) {
      if (mio !== peticion) return;
      movements = []; truncado = false;
      toast('No se pudo cargar el historial: ' + err.message, 'danger', 6000);
    }
    aplicarFiltro(tipoActivo);
  }, { activo: presetGuardado });

}

export default { render };
