import { getAll, addRecord, nextFolio } from '../data.js';
import { applyStockChange } from './inventoryCore.js';
import { addCashMovement } from './cajaCore.js';
import { renderTable, openModal, closeModal, toast, productSearch } from '../ui.js';
import { escapeHtml, formatQ, round2, todayISO } from '../utils.js';
import { getCurrentUser } from '../auth.js';
import { CONSUMIDOR_FINAL } from './clientes.js';

async function render(container) {
  const orders = await getAll('serviceOrders', { order: 'createdAt', direction: 'desc' });

  const table = renderTable({
    columns: [
      { key: 'numero', label: 'No.' },
      { key: 'fecha', label: 'Fecha' },
      { key: 'clienteNombre', label: 'Cliente' },
      { key: 'placa', label: 'Placa', format: (r) => r.vehiculo?.placa || '' },
      { key: 'empleados', label: 'Empleados', format: (r) => (r.empleados || []).map((e) => escapeHtml(e.empleadoNombre)).join(', ') },
      { key: 'total', label: 'Total', format: (r) => formatQ(r.total) },
      { key: 'acciones', label: '', format: (r) => `<button class="btn btn-secondary btn-sm" data-view="${r.id}">Ver detalle</button>` },
    ],
    rows: orders,
    searchKeys: ['numero', 'clienteNombre'],
    emptyMessage: 'Aún no hay órdenes de servicio.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Nueva orden de servicio</button>`,
  });

  container.innerHTML = `<div class="card">${table.html}</div>`;
  const card = container.querySelector('.card');
  table.mount(card);

  card.querySelector('#btn-new').addEventListener('click', openOrderForm);
  card.addEventListener('click', (e) => {
    const id = e.target.dataset.view;
    if (id) viewDetail(orders.find((o) => o.id === id));
  });

  function viewDetail(o) {
    openModal(`Orden ${o.numero}`, `
      <p><b>Cliente:</b> ${escapeHtml(o.clienteNombre)} &nbsp; <b>Fecha:</b> ${escapeHtml(o.fecha)}</p>
      <p><b>Vehículo:</b> ${escapeHtml(o.vehiculo?.marca)} ${escapeHtml(o.vehiculo?.modelo)} ${escapeHtml(o.vehiculo?.anio || '')} — Placa ${escapeHtml(o.vehiculo?.placa)}</p>
      <p><b>Empleados:</b> ${(o.empleados || []).map((e) => escapeHtml(e.empleadoNombre)).join(', ') || 'N/A'}</p>
      <div class="section-title">Servicios realizados</div>
      <ul>${(o.servicios || []).map((s) => `<li>${escapeHtml(s.nombre)} — ${formatQ(s.precio)}</li>`).join('') || '<li class="text-muted">Ninguno</li>'}</ul>
      <div class="section-title">Productos utilizados</div>
      ${o.productos?.length ? `<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
        <tbody>${o.productos.map((p) => `<tr><td>${escapeHtml(p.nombre)}</td><td>${p.cantidad}</td><td>${formatQ(p.precio)}</td><td>${formatQ(p.subtotal)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="text-muted">Ninguno</p>'}
      ${o.observaciones ? `<p class="mt-16"><b>Observaciones:</b> ${escapeHtml(o.observaciones)}</p>` : ''}
      <p class="mt-16">Mano de obra: ${formatQ(o.costoManoObra)} &nbsp; Productos: ${formatQ(o.costoProductos)}</p>
      <p class="text-right"><b>Total: ${formatQ(o.total)}</b></p>
    `);
  }

  async function openOrderForm() {
    const [services, products, users] = await Promise.all([
      getAll('services', { order: 'nombre' }),
      getAll('products', { order: 'nombre' }),
      getAll('users', { order: 'nombre' }),
    ]);
    const activeUsers = users.filter((u) => u.activo !== false);
    if (!activeUsers.length) { toast('No hay usuarios activos para asignar la orden.', 'danger'); return; }
    const customers = await getAll('customers', { order: 'nombre' });
    const currentUser = getCurrentUser();

    const productCart = [];
    const activeProducts = products.filter((p) => p.estado !== 'inactivo');
    const prodSearch = productSearch(activeProducts, { id: 'os-producto' });

    openModal('Nueva orden de servicio', `
      <label>Cliente
        <select id="os-cliente">
          <option value="CF">Consumidor Final</option>
          ${customers.map((c) => `<option value="${c.id}" data-nombre="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('')}
        </select>
      </label>

      <div class="section-title">Empleados que realizaron el servicio</div>
      <div class="tag-list" id="os-empleados">
        ${activeUsers.map((u) => `<label class="chip" style="cursor:pointer">
            <input type="checkbox" value="${u.id}" data-nombre="${escapeHtml(u.nombre)}" data-comision="${u.comision || 0}" style="width:auto" ${u.id === currentUser.uid ? 'checked' : ''}> ${escapeHtml(u.nombre)}
          </label>`).join('')}
      </div>

      <div class="section-title">Vehículo</div>
      <div class="form-row">
        <label>Marca <input id="os-v-marca"></label>
        <label>Modelo <input id="os-v-modelo"></label>
      </div>
      <div class="form-row">
        <label>Año <input id="os-v-anio" type="number"></label>
        <label>Placa <input id="os-v-placa"></label>
      </div>

      <div class="section-title">Servicios realizados</div>
      <div class="tag-list" id="os-servicios">
        ${services.map((s) => `<label class="chip" style="cursor:pointer">
            <input type="checkbox" value="${s.id}" data-nombre="${escapeHtml(s.nombre)}" data-precio="${s.precio}" style="width:auto"> ${escapeHtml(s.nombre)} (${formatQ(s.precio)})
          </label>`).join('') || '<span class="text-muted">No hay servicios en el catálogo.</span>'}
      </div>

      <div class="section-title">Productos utilizados</div>
      <div class="form-row">
        ${prodSearch.html}
        <label>Cantidad <input type="number" id="os-cantidad" min="1" step="1" value="1"></label>
      </div>
      <button type="button" class="btn btn-secondary" id="os-add-prod">+ Agregar producto</button>
      <div id="os-cart-list" class="text-muted mt-16">Sin productos agregados.</div>

      <div class="section-title">Costos</div>
      <div class="form-row">
        <label>Costo mano de obra (Q)
          <input type="number" id="os-mano-obra" min="0" step="0.01" value="0">
        </label>
        <label style="display:flex;align-items:flex-end">
          <button type="button" class="btn btn-secondary btn-block" id="os-sum-servicios">Usar suma de servicios como mano de obra</button>
        </label>
      </div>
      <label>Observaciones <textarea id="os-obs" rows="2"></textarea></label>

      <div class="section-title">Forma de pago</div>
      <label>Pago
        <select id="os-pago">
          <option value="efectivo">Efectivo</option>
          <option value="transferencia">Transferencia</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="mixto">Mixto</option>
        </select>
      </label>
      <div id="os-pago-efectivo" class="form-row">
        <label>Monto recibido (Q) <input type="number" id="os-recibido" min="0" step="0.01"></label>
        <label>Vuelto <input type="text" id="os-vuelto" value="Q 0.00" disabled></label>
      </div>
      <div id="os-pago-mixto" class="form-row" style="display:none">
        <label>Parte en efectivo (Q) <input type="number" id="os-mixto-efectivo" min="0" step="0.01" value="0"></label>
        <label>Parte tarjeta/transferencia (Q) <input type="number" id="os-mixto-otro" min="0" step="0.01" value="0"></label>
      </div>

      <p class="text-right mt-16"><b id="os-total">Total: Q 0.00</b></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
        <button type="button" class="btn btn-primary" id="os-save">Guardar orden</button>
      </div>
    `);

    const $ = (id) => document.getElementById(id);
    document.getElementById('cancel-form').addEventListener('click', closeModal);

    function selectedServicios() {
      return [...document.querySelectorAll('#os-servicios input:checked')].map((el) => ({
        servicioId: el.value, nombre: el.dataset.nombre, precio: Number(el.dataset.precio),
      }));
    }

    function selectedEmpleados() {
      return [...document.querySelectorAll('#os-empleados input:checked')].map((el) => ({
        empleadoId: el.value, empleadoNombre: el.dataset.nombre, comisionPct: Number(el.dataset.comision) || 0,
      }));
    }

    function renderCart() {
      const list = $('os-cart-list');
      list.innerHTML = productCart.length ? productCart.map((i, idx) => `
        <div class="cart-line">
          <span style="flex:1">${escapeHtml(i.nombre)}</span>
          <span>${i.cantidad} x ${formatQ(i.precio)}</span>
          <b style="width:90px;text-align:right">${formatQ(i.subtotal)}</b>
          <button type="button" class="btn btn-danger btn-sm" data-rm="${idx}">✕</button>
        </div>`).join('') : '<span class="text-muted">Sin productos agregados.</span>';
      list.querySelectorAll('[data-rm]').forEach((btn) => btn.addEventListener('click', () => {
        productCart.splice(Number(btn.dataset.rm), 1); renderCart(); updateTotal();
      }));
      updateTotal();
    }

    function updateTotal() {
      const costoProductos = round2(productCart.reduce((s, i) => s + i.subtotal, 0));
      const manoObra = Number($('os-mano-obra').value) || 0;
      const total = round2(costoProductos + manoObra);
      $('os-total').textContent = `Total: ${formatQ(total)}`;
      if ($('os-pago').value === 'efectivo') {
        const recibido = Number($('os-recibido').value) || 0;
        $('os-vuelto').value = formatQ(Math.max(0, round2(recibido - total)));
      }
      return { costoProductos, manoObra, total };
    }

    const buscador = prodSearch.mount();

    $('os-add-prod').addEventListener('click', () => {
      if (!activeProducts.length) { toast('No hay productos en el catálogo para agregar.', 'danger'); return; }
      const prod = buscador.getSelected();
      if (!prod) { toast('Escribe el nombre del producto y elígelo de la lista.', 'danger'); return; }
      const cantidad = Number($('os-cantidad').value);
      const stock = Number(prod.stock);
      if (!cantidad || cantidad <= 0) { toast('Cantidad inválida.', 'danger'); return; }
      const yaEnCarrito = productCart.filter((i) => i.productoId === prod.id).reduce((s, i) => s + i.cantidad, 0);
      if (cantidad + yaEnCarrito > stock) { toast(`Solo hay ${stock} en stock.`, 'danger'); return; }
      const precio = Number(prod.precioVenta);
      productCart.push({ productoId: prod.id, nombre: prod.nombre, cantidad, precio, subtotal: round2(cantidad * precio) });
      buscador.clear();
      $('os-cantidad').value = 1;
      renderCart();
    });

    $('os-sum-servicios').addEventListener('click', () => {
      const sum = round2(selectedServicios().reduce((s, sv) => s + sv.precio, 0));
      $('os-mano-obra').value = sum;
      updateTotal();
    });
    $('os-mano-obra').addEventListener('input', updateTotal);
    $('os-recibido').addEventListener('input', updateTotal);
    $('os-pago').addEventListener('change', (e) => {
      $('os-pago-efectivo').style.display = e.target.value === 'efectivo' ? '' : 'none';
      $('os-pago-mixto').style.display = e.target.value === 'mixto' ? '' : 'none';
      updateTotal();
    });

    $('os-save').addEventListener('click', async () => {
      const empleadosOrden = selectedEmpleados();
      if (!empleadosOrden.length) { toast('Selecciona al menos un empleado que realizó el servicio.', 'danger'); return; }
      const { costoProductos, manoObra, total } = updateTotal();
      const formaPago = $('os-pago').value;
      let recibido = Number($('os-recibido').value) || 0;
      let efectivoMixto = 0;
      if (formaPago === 'mixto') {
        efectivoMixto = Number($('os-mixto-efectivo').value) || 0;
        const otro = Number($('os-mixto-otro').value) || 0;
        if (round2(efectivoMixto + otro) < total) { toast('La suma de efectivo + tarjeta/transferencia es menor al total.', 'danger'); return; }
        recibido = round2(efectivoMixto + otro);
      }
      if (formaPago === 'efectivo' && recibido < total) { toast('El monto recibido es menor al total.', 'danger'); return; }
      const saveBtn = $('os-save');
      saveBtn.disabled = true;
      try {
        const clienteOpt = $('os-cliente').selectedOptions[0];
        const clienteId = clienteOpt.value;
        const clienteNombre = clienteId === 'CF' ? CONSUMIDOR_FINAL.nombre : clienteOpt.dataset.nombre;
        const numero = await nextFolio('serviceOrders', { prefix: 'OS-', pad: 5 });
        const vuelto = (formaPago === 'efectivo' || formaPago === 'mixto') ? Math.max(0, round2(recibido - total)) : 0;
        const orderId = await addRecord('serviceOrders', {
          numero,
          fecha: todayISO(),
          clienteId, clienteNombre,
          vehiculo: { marca: $('os-v-marca').value.trim(), modelo: $('os-v-modelo').value.trim(), anio: $('os-v-anio').value, placa: $('os-v-placa').value.trim().toUpperCase() },
          servicios: selectedServicios(),
          productos: productCart,
          empleados: empleadosOrden,
          observaciones: $('os-obs').value.trim(),
          costoManoObra: manoObra,
          costoProductos,
          total,
          formaPago,
          montoRecibido: (formaPago === 'efectivo' || formaPago === 'mixto') ? recibido : total,
          vuelto,
        });
        for (const item of productCart) {
          await applyStockChange(item.productoId, -item.cantidad, { motivo: 'servicio', referenciaId: orderId, usuario: currentUser });
        }
        // Solo el efectivo físico recibido entra al arqueo de caja (tarjeta/transferencia no).
        const efectivoEnCaja = formaPago === 'efectivo' ? recibido : formaPago === 'mixto' ? efectivoMixto : 0;
        if (efectivoEnCaja > 0) {
          await addCashMovement({ tipo: 'entrada', categoria: 'servicio', monto: efectivoEnCaja, motivo: `Orden ${numero} — ${clienteNombre}`, referenciaId: orderId });
        }
        if (vuelto > 0) {
          await addCashMovement({ tipo: 'salida', categoria: 'vuelto', monto: vuelto, motivo: `Vuelto orden ${numero}`, referenciaId: orderId });
        }
        toast('Orden de servicio guardada.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo guardar la orden: ' + err.message, 'danger');
        saveBtn.disabled = false;
      }
    });

    renderCart();
  }
}

export default { render };
