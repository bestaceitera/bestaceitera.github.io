import { getAll } from '../data.js';
import { renderTable, openModal, closeModal, toast, productSearch } from '../ui.js';
import { formatQ, formatDateTime, escapeHtml, round2, todayISO } from '../utils.js';
import { applyStockChange } from './inventoryCore.js';
import { getCurrentUser } from '../auth.js';

async function render(container) {
  const [products, movements] = await Promise.all([
    getAll('products', { order: 'nombre' }),
    getAll('inventoryMovements', { order: 'createdAt', direction: 'desc' }),
  ]);

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
      { key: 'stockResultante', label: 'Stock resultante' },
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
      <div class="stat-card"><div class="label">Movimientos registrados</div><div class="value">${movements.length}</div></div>
    </div>
    ${lowStock.length ? `<div class="card" style="border-color:var(--danger);background:var(--danger-light);margin-bottom:16px">
        <b>⚠ Alerta de stock bajo:</b> ${lowStock.map((p) => `${p.nombre} (${p.stock})`).join(', ')}
      </div>` : ''}
    <div class="section-title">Kardex / historial de movimientos</div>
    <div class="card" id="inv-kardex-card">${table.html}</div>
  `;
  const card = container.querySelector('#inv-kardex-card');
  table.mount(card);
  card.querySelector('#btn-uso-propio').addEventListener('click', openUsoPropioForm);

  /**
   * Salida de productos para consumo propio del negocio: descuenta stock y deja
   * constancia en el kardex, pero NO toca la caja (no entra ni sale dinero, así
   * que no afecta el cuadre diario).
   */
  function openUsoPropioForm() {
    const activos = products.filter((p) => p.estado !== 'inactivo' && Number(p.stock) > 0);
    if (!activos.length) { toast('No hay productos con stock disponible.', 'danger'); return; }
    const user = getCurrentUser();
    const carrito = [];
    const buscador = productSearch(activos, { id: 'up-producto', label: 'Buscar producto', clearOnSelect: true });

    openModal('Salida por uso propio', `
      <div class="card" style="background:var(--primary-light);border-color:var(--primary);margin-bottom:14px">
        Estos productos <b>salen del inventario pero no mueven dinero</b>: no entran a la caja
        ni afectan el cuadre diario. Quedan registrados en el kardex a nombre de quien los saca.
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

    function renderLista() {
      const list = $('up-lista');
      if (!carrito.length) {
        list.innerHTML = '<span class="text-muted">Sin productos. Búscalos arriba y tócalos para agregarlos.</span>';
        return;
      }
      const costo = round2(carrito.reduce((s, i) => s + i.cantidad * i.precioCompra, 0));
      list.innerHTML = carrito.map((i, idx) => `
        <div class="cart-line">
          <span class="cart-name">${escapeHtml(i.nombre)}</span>
          <span class="cart-qty">
            <button type="button" class="btn btn-secondary btn-sm" data-dec="${idx}">−</button>
            <input type="number" min="1" step="1" value="${i.cantidad}" data-qty="${idx}">
            <button type="button" class="btn btn-secondary btn-sm" data-inc="${idx}">+</button>
          </span>
          <span class="text-muted" style="font-size:12.5px">de ${i.stock}</span>
          <button type="button" class="btn btn-danger btn-sm" data-rm="${idx}">✕</button>
        </div>`).join('')
        + `<p class="text-right mt-16 text-muted">Costo de lo que sale: <b>${formatQ(costo)}</b></p>`;

      const setQty = (idx, valor) => {
        const item = carrito[idx];
        const n = Math.max(1, Math.floor(Number(valor) || 1));
        if (n > item.stock) { toast(`Solo hay ${item.stock} de ${item.nombre}.`, 'danger'); item.cantidad = item.stock; }
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
        for (const item of carrito) {
          await applyStockChange(item.productoId, -item.cantidad, {
            motivo: 'uso propio',
            referenciaId: null,
            usuario: { uid: user?.uid, nombre: responsable },
            extra: { nota, fecha: $('up-fecha').value || todayISO() },
          });
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
