import { getAll, getById, addRecord, nextFolio } from '../data.js';
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
        <tbody>${o.productos.map((p) => `<tr><td>${escapeHtml(p.nombre)}${p.libre ? ' <span class="badge badge-info">suelto</span>' : ''}</td><td>${p.cantidad}</td><td>${formatQ(p.precio)}</td><td>${formatQ(p.subtotal)}</td></tr>`).join('')}</tbody></table></div>`
        : '<p class="text-muted">Ninguno</p>'}
      ${o.observaciones ? `<p class="mt-16"><b>Observaciones:</b> ${escapeHtml(o.observaciones)}</p>` : ''}
      <p class="mt-16">Servicios: ${formatQ(o.costoServicios ?? 0)} &nbsp; Productos: ${formatQ(o.costoProductos)}${o.costoManoObra ? ` &nbsp; Mano de obra: ${formatQ(o.costoManoObra)}` : ''}</p>
      <p class="text-right"><b>Total: ${formatQ(o.total)}</b></p>
    `);
  }

  async function openOrderForm() {
    const [services, products, users] = await Promise.all([
      getAll('services', { order: 'nombre' }),
      getAll('products', { order: 'nombre' }),
      getAll('users', { order: 'nombre' }),
    ]);
    // Los empleados son quienes realizan el servicio (no las cuentas de acceso).
    const activeUsers = users.filter((u) => u.tipo === 'empleado' && u.activo !== false);
    if (!activeUsers.length) { toast('Primero registra a tus empleados en Usuarios → Empleados.', 'danger', 6000); return; }
    const customers = await getAll('customers', { order: 'nombre' });
    const currentUser = getCurrentUser();

    const productCart = [];
    const activeProducts = products.filter((p) => p.estado !== 'inactivo');
    const prodSearch = productSearch(activeProducts, { id: 'os-producto', label: 'Buscar producto', clearOnSelect: true });

    openModal('Nueva orden de servicio', `
      <div class="form-row">
        <label>Cliente
          <select id="os-cliente">
            <option value="CF">Consumidor Final</option>
            ${customers.map((c) => `<option value="${c.id}" data-nombre="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('')}
          </select>
        </label>
        <label>Fecha de la orden
          <input type="date" id="os-fecha" value="${todayISO()}" max="${todayISO()}">
        </label>
      </div>

      <div class="section-title">Empleados que realizaron el servicio</div>
      <div class="tag-list" id="os-empleados">
        ${activeUsers.map((u) => `<label class="chip" style="cursor:pointer">
            <input type="checkbox" value="${u.id}" data-nombre="${escapeHtml(u.nombre)}" data-comision="${u.comision || 0}" style="width:auto"> ${escapeHtml(u.nombre)}
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
      ${prodSearch.html}
      <button type="button" class="btn btn-secondary btn-block mt-16" id="os-libre-toggle">
        + Agregar algo que no está en la lista (filtro, etc.)
      </button>
      <div class="libre-box" id="os-libre" hidden>
        <div class="form-row">
          <label>¿Qué usaste?
            <input id="os-libre-desc" autocomplete="off" placeholder="ej. Filtro de aceite Corolla 2015">
          </label>
          <label>Precio (Q)
            <input type="number" id="os-libre-precio" min="0" step="0.01" placeholder="0.00">
          </label>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="os-libre-add">Agregar a la orden</button>
      </div>
      <div id="os-cart-list" class="text-muted mt-16">Sin productos agregados.</div>

      <label class="mt-16">Mano de obra adicional (Q) — opcional
        <input type="number" id="os-mano-obra" min="0" step="0.01" value="0">
      </label>
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

    // Un toque en el buscador agrega el producto; si ya estaba, suma uno más.
    prodSearch.mount({
      onSelect: (p) => {
        const existente = productCart.find((i) => i.productoId === p.id);
        if (existente) {
          if (existente.cantidad + 1 > Number(p.stock)) { toast(`Solo hay ${p.stock} de ${p.nombre}.`, 'danger'); return; }
          existente.cantidad += 1;
        } else {
          if (Number(p.stock) < 1) { toast(`${p.nombre} no tiene stock.`, 'danger'); return; }
          productCart.push({ productoId: p.id, nombre: p.nombre, stock: Number(p.stock), cantidad: 1, precio: Number(p.precioVenta) });
        }
        renderCart();
      },
    });

    // Artículo suelto: se describe y se le pone precio en el momento. No toca
    // inventario porque no es un producto del catálogo.
    const panelLibre = $('os-libre');
    $('os-libre-toggle').addEventListener('click', () => {
      panelLibre.hidden = !panelLibre.hidden;
      if (!panelLibre.hidden) $('os-libre-desc').focus();
    });

    function agregarLibre() {
      const desc = $('os-libre-desc').value.trim();
      const precio = Number($('os-libre-precio').value);
      if (!desc) { toast('Escribe qué usaste.', 'danger'); $('os-libre-desc').focus(); return; }
      if (!precio || precio <= 0) { toast('Ponle un precio.', 'danger'); $('os-libre-precio').focus(); return; }
      productCart.push({ productoId: null, libre: true, nombre: desc, cantidad: 1, precio });
      $('os-libre-desc').value = '';
      $('os-libre-precio').value = '';
      $('os-libre-desc').focus();
      renderCart();
    }
    $('os-libre-add').addEventListener('click', agregarLibre);
    ['os-libre-desc', 'os-libre-precio'].forEach((id) => {
      $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregarLibre(); } });
    });

    function renderCart() {
      const list = $('os-cart-list');
      if (!productCart.length) {
        list.innerHTML = '<span class="text-muted">Sin productos. Búscalos arriba y tócalos para agregarlos.</span>';
        updateTotal();
        return;
      }
      list.innerHTML = productCart.map((i, idx) => `
        <div class="cart-line">
          <span class="cart-name">${escapeHtml(i.nombre)}${i.libre ? ' <span class="badge badge-info">suelto</span>' : ''}</span>
          <span class="cart-qty">
            <button type="button" class="btn btn-secondary btn-sm" data-dec="${idx}">−</button>
            <input type="number" min="1" step="1" value="${i.cantidad}" data-qty="${idx}">
            <button type="button" class="btn btn-secondary btn-sm" data-inc="${idx}">+</button>
          </span>
          <span class="cart-price">Q <input type="number" min="0" step="0.01" value="${i.precio}" data-price="${idx}"></span>
          <b class="cart-sub">${formatQ(round2(i.cantidad * i.precio))}</b>
          <button type="button" class="btn btn-danger btn-sm" data-rm="${idx}">✕</button>
        </div>`).join('');

      const setQty = (idx, valor) => {
        const item = productCart[idx];
        const n = Math.max(1, Math.floor(Number(valor) || 1));
        // Los artículos sueltos no tienen stock que controlar.
        if (!item.libre && n > item.stock) { toast(`Solo hay ${item.stock} de ${item.nombre}.`, 'danger'); item.cantidad = item.stock; }
        else item.cantidad = n;
        renderCart();
      };
      list.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { productCart.splice(Number(b.dataset.rm), 1); renderCart(); }));
      list.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => setQty(Number(b.dataset.inc), productCart[Number(b.dataset.inc)].cantidad + 1)));
      list.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => {
        const idx = Number(b.dataset.dec);
        if (productCart[idx].cantidad <= 1) { productCart.splice(idx, 1); renderCart(); } else setQty(idx, productCart[idx].cantidad - 1);
      }));
      list.querySelectorAll('[data-qty]').forEach((el) => el.addEventListener('change', () => setQty(Number(el.dataset.qty), el.value)));
      list.querySelectorAll('[data-price]').forEach((el) => el.addEventListener('change', () => {
        productCart[Number(el.dataset.price)].precio = Math.max(0, Number(el.value) || 0);
        renderCart();
      }));
      updateTotal();
    }

    function updateTotal() {
      // Los servicios marcados ya cobran su precio; la mano de obra es un monto
      // adicional opcional que el usuario decide.
      const costoServicios = round2(selectedServicios().reduce((s, sv) => s + sv.precio, 0));
      const costoProductos = round2(productCart.reduce((s, i) => s + i.cantidad * i.precio, 0));
      const manoObra = Number($('os-mano-obra').value) || 0;
      const total = round2(costoServicios + costoProductos + manoObra);
      $('os-total').innerHTML = `<span class="text-muted" style="font-weight:400">Servicios ${formatQ(costoServicios)} · Productos ${formatQ(costoProductos)}${manoObra ? ` · Mano de obra ${formatQ(manoObra)}` : ''}</span><br>Total: ${formatQ(total)}`;
      if ($('os-pago').value === 'efectivo') {
        const recibido = Number($('os-recibido').value) || 0;
        // Sin nada que cobrar no hay vuelto que entregar.
        $('os-vuelto').value = formatQ(total > 0 ? Math.max(0, round2(recibido - total)) : 0);
      }
      return { costoServicios, costoProductos, manoObra, total };
    }

    document.getElementById('os-servicios').addEventListener('change', updateTotal);
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
      const { costoServicios, costoProductos, manoObra, total } = updateTotal();
      if (total <= 0) { toast('La orden no tiene ningún cobro: marca un servicio, agrega productos o pon mano de obra.', 'danger'); return; }
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
        // Igual que en ventas: se revalida el stock contra la base antes de guardar.
        for (const item of productCart.filter((i) => i.productoId)) {
          const actual = await getById('products', item.productoId);
          if (!actual) {
            toast(`El producto "${item.nombre}" ya no existe. Quítalo de la orden.`, 'danger', 6000);
            saveBtn.disabled = false; return;
          }
          if (Number(actual.stock || 0) < item.cantidad) {
            toast(`Ya solo quedan ${actual.stock || 0} de "${item.nombre}". Ajusta la cantidad.`, 'danger', 6000);
            saveBtn.disabled = false; return;
          }
        }

        const clienteOpt = $('os-cliente').selectedOptions[0];
        const clienteId = clienteOpt.value;
        const clienteNombre = clienteId === 'CF' ? CONSUMIDOR_FINAL.nombre : clienteOpt.dataset.nombre;
        const numero = await nextFolio('serviceOrders', { prefix: 'OS-', pad: 5 });
        const vuelto = (formaPago === 'efectivo' || formaPago === 'mixto') ? Math.max(0, round2(recibido - total)) : 0;
        const orderId = await addRecord('serviceOrders', {
          numero,
          fecha: $('os-fecha').value || todayISO(),
          clienteId, clienteNombre,
          vehiculo: { marca: $('os-v-marca').value.trim(), modelo: $('os-v-modelo').value.trim(), anio: $('os-v-anio').value, placa: $('os-v-placa').value.trim().toUpperCase() },
          servicios: selectedServicios(),
          productos: productCart.map((i) => ({
            productoId: i.productoId ?? null, libre: !!i.libre, nombre: i.nombre, cantidad: i.cantidad,
            precio: i.precio, subtotal: round2(i.cantidad * i.precio),
          })),
          empleados: empleadosOrden,
          observaciones: $('os-obs').value.trim(),
          costoManoObra: manoObra,
          costoServicios,
          costoProductos,
          total,
          formaPago,
          montoRecibido: (formaPago === 'efectivo' || formaPago === 'mixto') ? recibido : total,
          vuelto,
        });
        // Los artículos sueltos no están en el catálogo, así que no descuentan inventario.
        for (const item of productCart.filter((i) => i.productoId)) {
          await applyStockChange(item.productoId, -item.cantidad, { motivo: 'servicio', referenciaId: orderId, usuario: currentUser });
        }
        // Solo el efectivo físico recibido entra al arqueo de caja (tarjeta/transferencia no).
        const efectivoEnCaja = formaPago === 'efectivo' ? recibido : formaPago === 'mixto' ? efectivoMixto : 0;
        if (efectivoEnCaja > 0) {
          await addCashMovement({ tipo: 'entrada', categoria: 'servicio', monto: efectivoEnCaja, motivo: `Orden ${numero} — ${clienteNombre}`, referenciaId: orderId, fecha: $('os-fecha').value || todayISO() });
        }
        if (vuelto > 0) {
          await addCashMovement({ tipo: 'salida', categoria: 'vuelto', monto: vuelto, motivo: `Vuelto orden ${numero}`, referenciaId: orderId, fecha: $('os-fecha').value || todayISO() });
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
