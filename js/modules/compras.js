import { getAll, addRecord, nextFolio } from '../data.js';
import { applyStockChanges } from './inventoryCore.js';
import { addCashMovement } from './cajaCore.js';
import { renderTable, openModal, closeModal, toast } from '../ui.js';
import { escapeHtml, formatQ, round2, todayISO } from '../utils.js';
import { getCurrentUser } from '../auth.js';

async function render(container) {
  const purchases = await getAll('purchases', { order: 'createdAt', direction: 'desc', max: 300 });

  const table = renderTable({
    columns: [
      { key: 'numero', label: 'No.' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'proveedorNombre', label: 'Proveedor' },
      { key: 'usuarioNombre', label: 'Usuario' },
      { key: 'total', label: 'Total', format: (r) => formatQ(r.total) },
      { key: 'acciones', label: '', format: (r) => `<button class="btn btn-secondary btn-sm" data-view="${r.id}">Ver detalle</button>` },
    ],
    rows: purchases,
    searchKeys: ['numero', 'proveedorNombre', 'usuarioNombre'],
    emptyMessage: 'Aún no hay compras registradas.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Registrar compra</button>`,
  });

  container.innerHTML = `<div class="card">${table.html}</div>`;
  const card = container.querySelector('.card');
  table.mount(card);

  card.querySelector('#btn-new').addEventListener('click', openPurchaseForm);
  card.addEventListener('click', (e) => {
    const id = e.target.dataset.view;
    if (id) viewDetail(purchases.find((p) => p.id === id));
  });

  function viewDetail(p) {
    openModal(`Compra ${p.numero}`, `
      <p><b>Proveedor:</b> ${escapeHtml(p.proveedorNombre)}<br>
      <b>Fecha:</b> ${escapeHtml(p.fecha)} &nbsp; <b>Usuario:</b> ${escapeHtml(p.usuarioNombre)}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Producto</th><th>Cantidad</th><th>P. Compra</th><th>Subtotal</th></tr></thead>
        <tbody>${p.items.map((i) => `<tr><td>${escapeHtml(i.nombre)}</td><td>${i.cantidad}</td><td>${formatQ(i.precioCompra)}</td><td>${formatQ(i.subtotal)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="text-right" style="margin-top:10px"><b>Total: ${formatQ(p.total)}</b></p>
    `);
  }

  async function openPurchaseForm() {
    const [allSuppliers, products] = await Promise.all([
      getAll('suppliers', { order: 'empresa' }),
      getAll('products', { order: 'nombre' }),
    ]);
    const suppliers = allSuppliers.filter((s) => s.estado !== 'inactivo');
    if (!suppliers.length) { toast('Primero registra al menos un proveedor.', 'danger'); return; }
    if (!products.length) { toast('Primero registra al menos un producto.', 'danger'); return; }

    const cart = [];

    openModal('Registrar compra', `
      <div class="form-row">
        <label>Proveedor
          <select id="c-proveedor">${suppliers.map((s) => `<option value="${s.id}" data-nombre="${escapeHtml(s.empresa)}">${escapeHtml(s.empresa)}</option>`).join('')}</select>
        </label>
        <label>Fecha
          <input type="date" id="c-fecha" value="${todayISO()}">
        </label>
      </div>
      <div class="section-title">Agregar producto</div>
      <div class="form-row">
        <label>Producto
          <select id="c-producto">${products.map((p) => `<option value="${p.id}" data-precio="${p.precioCompra}" data-nombre="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</option>`).join('')}</select>
        </label>
        <label>Cantidad
          <input type="number" id="c-cantidad" min="1" step="1" value="1">
        </label>
      </div>
      <div class="form-row">
        <label>Precio de compra (Q)
          <input type="number" id="c-precio" min="0" step="0.01" value="${products[0].precioCompra}">
        </label>
        <label style="display:flex;align-items:flex-end">
          <button type="button" class="btn btn-secondary btn-block" id="c-add">+ Agregar a la compra</button>
        </label>
      </div>
      <div class="section-title">Detalle</div>
      <div id="c-cart-list" class="text-muted">Sin productos agregados.</div>
      <p class="text-right mt-16"><b id="c-total">Total: Q 0.00</b></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
        <button type="button" class="btn btn-primary" id="c-save">Guardar compra</button>
      </div>
    `);

    const $ = (id) => document.getElementById(id);
    $('c-producto').addEventListener('change', (e) => {
      const opt = e.target.selectedOptions[0];
      $('c-precio').value = opt.dataset.precio;
    });
    document.getElementById('cancel-form').addEventListener('click', closeModal);

    function renderCart() {
      const list = $('c-cart-list');
      if (!cart.length) { list.innerHTML = '<span class="text-muted">Sin productos agregados.</span>'; }
      else {
        list.innerHTML = cart.map((i, idx) => `
          <div class="cart-line">
            <span style="flex:1">${escapeHtml(i.nombre)}</span>
            <span>${i.cantidad} x ${formatQ(i.precioCompra)}</span>
            <b style="width:90px;text-align:right">${formatQ(i.subtotal)}</b>
            <button type="button" class="btn btn-danger btn-sm" data-rm="${idx}">✕</button>
          </div>`).join('');
      }
      const total = round2(cart.reduce((s, i) => s + i.subtotal, 0));
      $('c-total').textContent = `Total: ${formatQ(total)}`;
      list.querySelectorAll('[data-rm]').forEach((btn) => btn.addEventListener('click', () => {
        cart.splice(Number(btn.dataset.rm), 1); renderCart();
      }));
    }

    $('c-add').addEventListener('click', () => {
      const opt = $('c-producto').selectedOptions[0];
      const cantidad = Number($('c-cantidad').value);
      const precioCompra = Number($('c-precio').value);
      if (!cantidad || cantidad <= 0) { toast('Cantidad inválida.', 'danger'); return; }
      cart.push({ productoId: opt.value, nombre: opt.dataset.nombre, cantidad, precioCompra, subtotal: round2(cantidad * precioCompra) });
      renderCart();
    });

    $('c-save').addEventListener('click', async () => {
      if (!cart.length) { toast('Agrega al menos un producto.', 'danger'); return; }
      const saveBtn = $('c-save');
      saveBtn.disabled = true;
      try {
        const user = getCurrentUser();
        const provOpt = $('c-proveedor').selectedOptions[0];
        const total = round2(cart.reduce((s, i) => s + i.subtotal, 0));
        const numero = await nextFolio('purchases', { prefix: 'C', pad: 1 });
        // La fecha se lee UNA vez: la compra, su movimiento de inventario y su
        // salida de caja tienen que quedar todos en el mismo día.
        const fechaCompra = $('c-fecha').value || todayISO();
        const purchaseId = await addRecord('purchases', {
          numero,
          proveedorId: provOpt.value,
          proveedorNombre: provOpt.dataset.nombre,
          fecha: fechaCompra,
          usuarioId: user.uid,
          usuarioNombre: user.nombre,
          items: cart,
          total,
        });
        // Juntos: recibir una factura de veinte productos no tiene por qué esperar
        // veinte viajes al servidor uno tras otro.
        await applyStockChanges(
          cart.map((i) => ({ productoId: i.productoId, delta: i.cantidad, nombre: i.nombre })),
          { motivo: 'compra', referenciaId: purchaseId, usuario: user, fecha: fechaCompra },
        );
        // La salida de caja lleva la fecha de la compra, no la de hoy: así registrar
        // hoy una compra de la semana pasada no descuadra el efectivo de hoy.
        await addCashMovement({
          tipo: 'salida', categoria: 'compra', monto: total,
          motivo: `Compra ${numero} — ${provOpt.dataset.nombre}`, referenciaId: purchaseId,
          fecha: fechaCompra,
        });
        toast('Compra registrada. Inventario actualizado.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo registrar la compra: ' + err.message, 'danger');
        saveBtn.disabled = false;
      }
    });

    renderCart();
  }
}

export default { render };
