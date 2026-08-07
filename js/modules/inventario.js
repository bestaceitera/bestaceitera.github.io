import { getAll, getByDateRange, addRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, productSearch, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { formatQ, formatDateTime, escapeHtml, round2, todayISO } from '../utils.js';
import { applyStockChange } from './inventoryCore.js';
import { getCurrentUser } from '../auth.js';

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

  const lowStock = products.filter((p) => Number(p.stock) <= Number(p.stockMinimo ?? 0));

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
    ${lowStock.length ? `<div class="card" style="border-color:var(--danger);background:var(--danger-light);margin-bottom:16px">
        <b>⚠ Alerta de stock bajo:</b> ${lowStock.map((p) => `${p.nombre} (${p.stock})`).join(', ')}
      </div>` : ''}
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
  card.querySelector('#btn-uso-propio').addEventListener('click', openUsoPropioForm);

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

  /**
   * Salida de productos para consumo propio del negocio: descuenta stock y deja
   * constancia en el historial, pero NO toca la caja (no entra ni sale dinero, así
   * que no afecta el cuadre diario).
   */
  function openUsoPropioForm() {
    const activos = products.filter((p) => p.estado !== 'inactivo' && Number(p.stock) > 0);
    const user = getCurrentUser();
    const carrito = [];
    const buscador = productSearch(activos, { id: 'up-producto', label: 'Buscar producto', clearOnSelect: true });

    openModal('Salida por uso propio', `
      <div class="card" style="background:var(--primary-light);border-color:var(--primary);margin-bottom:14px">
        Estos productos <b>salen del inventario pero no mueven dinero</b>: no entran a la caja
        ni afectan el cuadre diario. Quedan registrados en el historial a nombre de quien los saca.
      </div>
      <div class="form-row">
        <label>Responsable <input id="up-responsable" value="${escapeHtml(user?.nombre || '')}"></label>
        <label>Fecha <input type="date" id="up-fecha" value="${todayISO()}" max="${todayISO()}"></label>
      </div>
      <label>¿Para qué? (opcional)
        <input id="up-nota" autocomplete="off" placeholder="ej. Uso en el otro negocio">
      </label>

      <div class="section-title">Productos que salen</div>
      ${buscador.html}
      <button type="button" class="btn btn-secondary btn-block mt-16" id="up-libre-toggle">
        + Sacar algo que no está en la lista (filtro, etc.)
      </button>
      <div class="libre-box" id="up-libre" hidden>
        <label>¿Qué sacaste?
          <input id="up-libre-desc" autocomplete="off" placeholder="ej. Filtro de aire Autox L200">
        </label>
        <p class="text-muted" style="font-size:12.5px;margin:6px 0 10px">
          Como no está en el catálogo, no descuenta stock: queda solo como constancia de que salió.
        </p>
        <button type="button" class="btn btn-primary btn-block" id="up-libre-add">Agregar a la salida</button>
      </div>
      <div id="up-lista" class="text-muted mt-16">Sin productos. Búscalos arriba y tócalos para agregarlos.</div>

      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
        <button type="button" class="btn btn-primary" id="up-save">Registrar salida</button>
      </div>
    `);

    const $ = (id) => document.getElementById(id);
    $('cancel-form').addEventListener('click', closeModal);

    buscador.mount({
      onSelect: (p) => {
        const existente = carrito.find((i) => i.productoId === p.id);
        if (existente) {
          if (existente.cantidad + 1 > Number(p.stock)) { toast(`Solo hay ${p.stock} de ${p.nombre}.`, 'danger'); return; }
          existente.cantidad += 1;
        } else {
          carrito.push({ productoId: p.id, nombre: p.nombre, stock: Number(p.stock), cantidad: 1, precioCompra: Number(p.precioCompra || 0) });
        }
        renderLista();
      },
    });

    // Artículo que no está en el catálogo: se anota igual para dejar constancia,
    // aunque no haya stock que descontar.
    const panelLibre = $('up-libre');
    $('up-libre-toggle').addEventListener('click', () => {
      panelLibre.hidden = !panelLibre.hidden;
      if (!panelLibre.hidden) $('up-libre-desc').focus();
    });
    function agregarLibre() {
      const desc = $('up-libre-desc').value.trim();
      if (!desc) { toast('Escribe qué sacaste.', 'danger'); $('up-libre-desc').focus(); return; }
      carrito.push({ productoId: null, libre: true, nombre: desc, cantidad: 1, precioCompra: 0 });
      $('up-libre-desc').value = '';
      $('up-libre-desc').focus();
      renderLista();
    }
    $('up-libre-add').addEventListener('click', agregarLibre);
    $('up-libre-desc').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); agregarLibre(); }
    });

    function renderLista() {
      const list = $('up-lista');
      if (!carrito.length) {
        list.innerHTML = '<span class="text-muted">Sin productos. Búscalos arriba y tócalos para agregarlos.</span>';
        return;
      }
      const costo = round2(carrito.reduce((s, i) => s + i.cantidad * i.precioCompra, 0));
      list.innerHTML = carrito.map((i, idx) => `
        <div class="cart-line">
          <span class="cart-name">${escapeHtml(i.nombre)}${i.libre ? ' <span class="badge badge-info">no descuenta stock</span>' : ''}</span>
          <span class="cart-qty">
            <button type="button" class="btn btn-secondary btn-sm" data-dec="${idx}">−</button>
            <input type="number" min="1" step="1" value="${i.cantidad}" data-qty="${idx}">
            <button type="button" class="btn btn-secondary btn-sm" data-inc="${idx}">+</button>
          </span>
          <span class="text-muted" style="font-size:12.5px">${i.libre ? '' : 'de ' + i.stock}</span>
          <button type="button" class="btn btn-danger btn-sm" data-rm="${idx}">✕</button>
        </div>`).join('')
        + `<p class="text-right mt-16 text-muted">Costo de lo que sale: <b>${formatQ(costo)}</b></p>`;

      const setQty = (idx, valor) => {
        const item = carrito[idx];
        const n = Math.max(1, Math.floor(Number(valor) || 1));
        if (!item.libre && n > item.stock) { toast(`Solo hay ${item.stock} de ${item.nombre}.`, 'danger'); item.cantidad = item.stock; }
        else item.cantidad = n;
        renderLista();
      };
      list.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { carrito.splice(Number(b.dataset.rm), 1); renderLista(); }));
      list.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => setQty(Number(b.dataset.inc), carrito[Number(b.dataset.inc)].cantidad + 1)));
      list.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => {
        const idx = Number(b.dataset.dec);
        if (carrito[idx].cantidad <= 1) { carrito.splice(idx, 1); renderLista(); } else setQty(idx, carrito[idx].cantidad - 1);
      }));
      list.querySelectorAll('[data-qty]').forEach((el) => el.addEventListener('change', () => setQty(Number(el.dataset.qty), el.value)));
    }

    $('up-save').addEventListener('click', async () => {
      if (!carrito.length) { toast('Agrega al menos un producto.', 'danger'); return; }
      const responsable = $('up-responsable').value.trim();
      if (!responsable) { toast('Escribe quién saca los productos.', 'danger'); return; }
      const btn = $('up-save');
      btn.disabled = true;
      btn.textContent = 'Guardando…';
      try {
        const nota = $('up-nota').value.trim();
        const fecha = $('up-fecha').value || todayISO();
        for (const item of carrito) {
          if (item.productoId) {
            await applyStockChange(item.productoId, -item.cantidad, {
              motivo: 'uso propio',
              referenciaId: null,
              usuario: { uid: user?.uid, nombre: responsable },
              extra: { nota, fecha },
            });
          } else {
            // No está en el catálogo: no hay stock que mover, solo queda la constancia.
            await addRecord('inventoryMovements', {
              productoId: null, libre: true, productoNombre: item.nombre,
              tipo: 'salida', motivo: 'uso propio', cantidad: item.cantidad,
              stockResultante: null, referenciaId: null,
              usuarioId: user?.uid || null, usuarioNombre: responsable,
              nota, fecha,
            });
          }
        }
        toast('Salida registrada. No afecta la caja.', 'success', 4500);
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo registrar la salida: ' + err.message, 'danger');
        btn.disabled = false;
        btn.textContent = 'Registrar salida';
      }
    });

    renderLista();
  }
}

export default { render };
