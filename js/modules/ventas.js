import { getAll, addRecord, nextFolio } from '../data.js';
import { applyStockChange } from './inventoryCore.js';
import { addCashMovement } from './cajaCore.js';
import { renderTable, openModal, closeModal, toast, productSearch } from '../ui.js';
import { escapeHtml, formatQ, round2, todayISO } from '../utils.js';
import { getCurrentUser } from '../auth.js';
import { CONSUMIDOR_FINAL } from './clientes.js';

async function render(container) {
  const sales = await getAll('sales', { order: 'createdAt', direction: 'desc' });

  const table = renderTable({
    columns: [
      { key: 'numero', label: 'No.' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'clienteNombre', label: 'Cliente' },
      { key: 'formaPago', label: 'Pago', format: (r) => `<span class="badge badge-info">${escapeHtml(r.formaPago)}</span>` },
      { key: 'total', label: 'Total', format: (r) => formatQ(r.total) },
      { key: 'usuarioNombre', label: 'Usuario' },
      { key: 'acciones', label: '', format: (r) => `<button class="btn btn-secondary btn-sm" data-view="${r.id}">Ver detalle</button>` },
    ],
    rows: sales,
    searchKeys: ['numero', 'clienteNombre', 'usuarioNombre'],
    emptyMessage: 'Aún no hay ventas registradas.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Nueva venta</button>`,
  });

  container.innerHTML = `<div class="card">${table.html}</div>`;
  const card = container.querySelector('.card');
  table.mount(card);

  card.querySelector('#btn-new').addEventListener('click', openSaleForm);
  card.addEventListener('click', (e) => {
    const id = e.target.dataset.view;
    if (id) viewDetail(sales.find((s) => s.id === id));
  });

  function viewDetail(s) {
    openModal(`Venta ${s.numero}`, `
      <p><b>Cliente:</b> ${escapeHtml(s.clienteNombre)} &nbsp; <b>Fecha:</b> ${escapeHtml(s.fecha)} &nbsp; <b>Usuario:</b> ${escapeHtml(s.usuarioNombre)}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Desc.</th><th>Subtotal</th></tr></thead>
        <tbody>${s.items.map((i) => `<tr><td>${escapeHtml(i.nombre)}</td><td>${i.cantidad}</td><td>${formatQ(i.precio)}</td><td>${formatQ(i.descuento)}</td><td>${formatQ(i.subtotal)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="mt-16 text-right">${s.iva > 0 ? `Subtotal: ${formatQ(s.subtotal)}<br>IVA (12%): ${formatQ(s.iva)}<br>` : ''}<b>Total: ${formatQ(s.total)}</b></p>
      <p><b>Forma de pago:</b> ${escapeHtml(s.formaPago)} ${s.formaPago !== 'transferencia' && s.formaPago !== 'tarjeta' ? `— Recibido ${formatQ(s.montoRecibido)}, Vuelto ${formatQ(s.vuelto)}` : ''}</p>
      <p><b>Empleados:</b> ${(s.empleadosComision || []).map((e) => escapeHtml(e.empleadoNombre)).join(', ') || 'N/A'}</p>
    `);
  }

  async function openSaleForm() {
    const [products, customers, users] = await Promise.all([
      getAll('products', { order: 'nombre' }),
      getAll('customers', { order: 'nombre' }),
      getAll('users', { order: 'nombre' }),
    ]);
    const activeProducts = products.filter((p) => p.estado !== 'inactivo');
    if (!activeProducts.length) { toast('No hay productos activos para vender.', 'danger'); return; }
    const activeUsers = users.filter((u) => u.activo !== false);
    const user = getCurrentUser();
    const cart = [];
    const prodSearch = productSearch(activeProducts, { id: 'v-producto' });

    openModal('Nueva venta', `
      <label>Cliente
        <select id="v-cliente">
          <option value="CF">Consumidor Final</option>
          ${customers.map((c) => `<option value="${c.id}" data-nombre="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('')}
        </select>
      </label>

      <div class="section-title">Empleados que realizaron esta venta</div>
      <div class="tag-list" id="v-empleados">
        ${activeUsers.map((u) => `<label class="chip" style="cursor:pointer">
            <input type="checkbox" value="${u.id}" data-nombre="${escapeHtml(u.nombre)}" data-comision="${u.comision || 0}" style="width:auto" ${u.id === user.uid ? 'checked' : ''}> ${escapeHtml(u.nombre)}
          </label>`).join('') || '<span class="text-muted">No hay usuarios activos.</span>'}
      </div>

      <div class="section-title">Agregar producto</div>
      <div class="form-row">
        ${prodSearch.html}
        <label>Cantidad <input type="number" id="v-cantidad" min="1" step="1" value="1"></label>
      </div>
      <div class="form-row">
        <label>Precio (Q) <input type="number" id="v-precio" min="0" step="0.01"></label>
        <label>Descuento (Q) <input type="number" id="v-descuento" min="0" step="0.01" value="0"></label>
      </div>
      <button type="button" class="btn btn-secondary" id="v-add">+ Agregar a la venta</button>
      <div id="v-cart-list" class="text-muted mt-16">Sin productos agregados.</div>

      <div class="section-title">Totales</div>
      <p id="v-totales" class="text-right"><b>Total: Q 0.00</b></p>

      <div class="section-title">Forma de pago</div>
      <label>Pago
        <select id="v-pago">
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="mixto">Mixto</option>
        </select>
      </label>
      <div id="v-pago-efectivo" class="form-row">
        <label>Monto recibido (Q) <input type="number" id="v-recibido" min="0" step="0.01"></label>
        <label>Vuelto <input type="text" id="v-vuelto" value="Q 0.00" disabled></label>
      </div>
      <div id="v-pago-mixto" class="form-row" style="display:none">
        <label>Parte en efectivo (Q) <input type="number" id="v-mixto-efectivo" min="0" step="0.01" value="0"></label>
        <label>Parte tarjeta/transferencia (Q) <input type="number" id="v-mixto-otro" min="0" step="0.01" value="0"></label>
      </div>

      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
        <button type="button" class="btn btn-primary" id="v-save">Registrar venta</button>
      </div>
    `);

    const $ = (id) => document.getElementById(id);
    document.getElementById('cancel-form').addEventListener('click', closeModal);

    function selectedEmpleados() {
      return [...document.querySelectorAll('#v-empleados input:checked')].map((el) => ({
        empleadoId: el.value, empleadoNombre: el.dataset.nombre, comisionPct: Number(el.dataset.comision) || 0,
      }));
    }

    const buscador = prodSearch.mount({ onSelect: (p) => { $('v-precio').value = p.precioVenta; } });

    function renderCart() {
      const list = $('v-cart-list');
      list.innerHTML = cart.length ? cart.map((i, idx) => `
        <div class="cart-line">
          <span style="flex:1">${escapeHtml(i.nombre)}</span>
          <span>${i.cantidad} x ${formatQ(i.precio)}${i.descuento ? ` − ${formatQ(i.descuento)}` : ''}</span>
          <b style="width:90px;text-align:right">${formatQ(i.subtotal)}</b>
          <button type="button" class="btn btn-danger btn-sm" data-rm="${idx}">✕</button>
        </div>`).join('') : '<span class="text-muted">Sin productos agregados.</span>';
      list.querySelectorAll('[data-rm]').forEach((btn) => btn.addEventListener('click', () => {
        cart.splice(Number(btn.dataset.rm), 1); renderCart();
      }));
      updateTotals();
    }

    function computeTotals() {
      const subtotal = round2(cart.reduce((s, i) => s + i.subtotal, 0));
      // El precio del producto es el precio final: no se suma IVA.
      return { subtotal, iva: 0, total: subtotal };
    }

    function updateTotals() {
      const { subtotal, iva, total } = computeTotals();
      $('v-totales').innerHTML = `<b>Total: ${formatQ(total)}</b>`;
      if ($('v-pago').value === 'efectivo') {
        const recibido = Number($('v-recibido').value) || 0;
        $('v-vuelto').value = formatQ(Math.max(0, round2(recibido - total)));
      }
      return { subtotal, iva, total };
    }

    $('v-add').addEventListener('click', () => {
      const prod = buscador.getSelected();
      if (!prod) { toast('Escribe el nombre del producto y elígelo de la lista.', 'danger'); return; }
      const cantidad = Number($('v-cantidad').value);
      const stock = Number(prod.stock);
      if (!cantidad || cantidad <= 0) { toast('Cantidad inválida.', 'danger'); return; }
      const yaEnCarrito = cart.filter((i) => i.productoId === prod.id).reduce((s, i) => s + i.cantidad, 0);
      if (cantidad + yaEnCarrito > stock) { toast(`Solo hay ${stock} en stock.`, 'danger'); return; }
      const precio = Number($('v-precio').value);
      if (!precio || precio <= 0) { toast('Ingresa un precio válido.', 'danger'); return; }
      const descuento = Number($('v-descuento').value) || 0;
      if (descuento < 0 || descuento > cantidad * precio) { toast('El descuento no puede ser mayor que el subtotal.', 'danger'); return; }
      cart.push({ productoId: prod.id, nombre: prod.nombre, cantidad, precio, descuento, subtotal: round2(cantidad * precio - descuento) });
      buscador.clear();
      $('v-precio').value = '';
      $('v-cantidad').value = 1;
      $('v-descuento').value = 0;
      renderCart();
    });

    $('v-recibido').addEventListener('input', updateTotals);
    $('v-pago').addEventListener('change', (e) => {
      $('v-pago-efectivo').style.display = e.target.value === 'efectivo' ? '' : 'none';
      $('v-pago-mixto').style.display = e.target.value === 'mixto' ? '' : 'none';
      updateTotals();
    });

    $('v-save').addEventListener('click', async () => {
      if (!cart.length) { toast('Agrega al menos un producto.', 'danger'); return; }
      const empleadosComision = selectedEmpleados();
      if (!empleadosComision.length) { toast('Selecciona al menos un empleado que realizó la venta.', 'danger'); return; }
      const { subtotal, iva, total } = computeTotals();
      const formaPago = $('v-pago').value;
      let montoRecibido = total, vuelto = 0;

      if (formaPago === 'efectivo') {
        montoRecibido = Number($('v-recibido').value) || 0;
        if (montoRecibido < total) { toast('El monto recibido es menor al total.', 'danger'); return; }
        vuelto = Math.max(0, round2(montoRecibido - total));
      } else if (formaPago === 'mixto') {
        const efectivo = Number($('v-mixto-efectivo').value) || 0;
        const otro = Number($('v-mixto-otro').value) || 0;
        if (round2(efectivo + otro) < total) { toast('La suma de efectivo + tarjeta/transferencia es menor al total.', 'danger'); return; }
        vuelto = Math.max(0, round2(efectivo + otro - total));
        montoRecibido = round2(efectivo + otro);
      }

      const saveBtn = $('v-save');
      saveBtn.disabled = true;
      try {
        const clienteOpt = $('v-cliente').selectedOptions[0];
        const clienteId = clienteOpt.value;
        const clienteNombre = clienteId === 'CF' ? CONSUMIDOR_FINAL.nombre : clienteOpt.dataset.nombre;
        const numero = await nextFolio('sales', { prefix: 'V-', pad: 6 });

        const saleId = await addRecord('sales', {
          numero, fecha: todayISO(), usuarioId: user.uid, usuarioNombre: user.nombre,
          clienteId, clienteNombre, clienteTipo: clienteId === 'CF' ? 'CF' : 'registrado',
          items: cart, subtotal, descuentoTotal: round2(cart.reduce((s, i) => s + i.descuento, 0)),
          iva, total, formaPago, montoRecibido, vuelto, empleadosComision,
        });

        for (const item of cart) {
          await applyStockChange(item.productoId, -item.cantidad, { motivo: 'venta', referenciaId: saleId, usuario: user });
        }

        // Solo se registra en caja el efectivo físico que realmente entra al cajón.
        // Tarjeta/transferencia no mueven efectivo, así que no afectan el arqueo de caja.
        const efectivoEnCaja = formaPago === 'efectivo' ? montoRecibido
          : formaPago === 'mixto' ? (Number($('v-mixto-efectivo').value) || 0)
          : 0;
        if (efectivoEnCaja > 0) {
          await addCashMovement({ tipo: 'entrada', categoria: 'venta', monto: efectivoEnCaja, motivo: `Venta ${numero} — ${clienteNombre}`, referenciaId: saleId });
        }
        if (vuelto > 0) {
          await addCashMovement({ tipo: 'salida', categoria: 'vuelto', monto: vuelto, motivo: `Vuelto venta ${numero}`, referenciaId: saleId });
        }

        toast(`Venta ${numero} registrada.` + (vuelto > 0 ? ` Vuelto: ${formatQ(vuelto)}` : ''), 'success', 5000);
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo registrar la venta: ' + err.message, 'danger');
        saveBtn.disabled = false;
      }
    });

    renderCart();
  }
}

export default { render };
