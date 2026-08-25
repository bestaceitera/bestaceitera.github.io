// Formulario de nueva venta. Vive aparte porque es la pieza más larga del
// sistema (buscador de productos, carrito, empleados, formas de pago, banco) y
// tenía a ventas.js pasado de tamaño. No depende de la pantalla: recibe lo que
// necesita y avisa por `onSaved` cuando termina.
import { nextFolio, setRecord, nuevoId } from '../data.js';
import { catalogo } from './catalogos.js';
import { applyStockChanges } from './inventoryCore.js';
import { addCashMovement } from './cajaCore.js';
import { listarBancos, etiquetaBanco } from './bancos.js';
import { openModal, closeModal, toast, productSearch } from '../ui.js';
import { escapeHtml, formatQ, round2, todayISO } from '../utils.js';
import { getCurrentUser } from '../auth.js';
import { CONSUMIDOR_FINAL } from './clientes.js';

export async function openSaleForm({ onSaved } = {}) {
  // Desde memoria: estos cuatro casi nunca cambian y antes se volvían a
  // descargar en cada "Nueva venta". Se mantienen al día solos (ver catalogos.js).
  const [products, customers, users, bancos] = await Promise.all([
    catalogo('products', { order: 'nombre' }),
    catalogo('customers', { order: 'nombre' }),
    catalogo('users', { order: 'nombre' }),
    listarBancos(),
  ]);
  // Aunque no haya productos en el catálogo se puede vender: existen los artículos sueltos.
  const activeProducts = products.filter((p) => p.estado !== 'inactivo');
  // Los empleados son quienes realizan la venta (no las cuentas de acceso).
  const activeUsers = users.filter((u) => u.tipo === 'empleado' && u.activo !== false);
  if (!activeUsers.length) { toast('Primero registra a tus empleados en Usuarios → Empleados.', 'danger', 6000); return; }
  const user = getCurrentUser();
  const cart = [];
  const prodSearch = productSearch(activeProducts, { id: 'v-producto', label: 'Buscar producto', clearOnSelect: true });

  openModal('Nueva venta', `
    <div class="form-row">
      <label>Cliente
        <select id="v-cliente">
          <option value="CF">Consumidor Final</option>
          ${customers.map((c) => `<option value="${c.id}" data-nombre="${escapeHtml(c.nombre)}">${escapeHtml(c.nombre)}</option>`).join('')}
        </select>
      </label>
      <label>Fecha de la venta
        <input type="date" id="v-fecha" value="${todayISO()}" max="${todayISO()}">
      </label>
    </div>

    <div class="section-title">¿Quién realizó esta venta?</div>
    <div class="tag-list" id="v-empleados">
      ${activeUsers.map((u) => `<label class="chip" style="cursor:pointer">
          <input type="checkbox" value="${u.id}" data-nombre="${escapeHtml(u.nombre)}" data-comision="${u.comision || 0}" style="width:auto"> ${escapeHtml(u.nombre)}
        </label>`).join('')}
    </div>

    <div class="section-title">Productos</div>
    ${prodSearch.html}
    <button type="button" class="btn btn-secondary btn-block mt-16" id="v-libre-toggle">
      + Vender algo que no está en la lista (filtro, etc.)
    </button>
    <div class="libre-box" id="v-libre" hidden>
      <div class="form-row">
        <label>¿Qué vendiste?
          <input id="v-libre-desc" autocomplete="off" placeholder="ej. Filtro de aceite Corolla 2015">
        </label>
        <label>Precio (Q)
          <input type="number" id="v-libre-precio" min="0" step="0.01" placeholder="0.00">
        </label>
      </div>
      <button type="button" class="btn btn-primary btn-block" id="v-libre-add">Agregar a la venta</button>
    </div>
    <div id="v-cart-list" class="text-muted mt-16">Sin productos agregados.</div>

    <div class="form-row mt-16">
      <label>Descuento (Q) <input type="number" id="v-descuento" min="0" step="0.01" value="0"></label>
      <p id="v-totales" class="text-right" style="align-self:flex-end;margin:0"><b>Total: Q 0.00</b></p>
    </div>

    <div class="section-title">Forma de pago</div>
    <label>Pago
      <select id="v-pago">
        <option value="efectivo">Efectivo</option>
        <option value="transferencia">Transferencia</option>
        <option value="tarjeta">Tarjeta</option>
        <option value="mixto">Mixto</option>
      </select>
    </label>
    <div id="v-pago-efectivo">
      <div class="pago-pregunta">¿Con cuánto te pagó?</div>
      <div class="billetes" id="v-billetes"></div>
      <label id="v-otro-box" style="display:none">Monto recibido (Q)
        <input type="number" id="v-recibido" min="0" step="0.01" placeholder="0.00">
      </label>
      <div class="vuelto-box" id="v-vuelto-box" hidden></div>
    </div>
    <div id="v-pago-mixto" class="form-row" style="display:none">
      <label>Parte en efectivo (Q) <input type="number" id="v-mixto-efectivo" min="0" step="0.01" value="0"></label>
      <label>Parte tarjeta/transferencia (Q) <input type="number" id="v-mixto-otro" min="0" step="0.01" value="0"></label>
    </div>
    <label id="v-banco-box" style="display:none">¿A qué banco te la hicieron?
      <select id="v-banco">
        <option value="">— Elige el banco —</option>
        ${bancos.map((b) => `<option value="${b.id}" data-nombre="${escapeHtml(b.nombre)}" data-cuenta="${escapeHtml(b.numeroCuenta || '')}">${escapeHtml(etiquetaBanco(b))}</option>`).join('')}
      </select>
      ${bancos.length ? '' : '<span class="text-muted" style="font-size:12.5px">No hay bancos registrados. Agrégalos en Almacén → Bancos.</span>'}
    </label>

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

  // Un toque en el buscador agrega el producto a la venta; si ya estaba, suma uno más.
  prodSearch.mount({
    onSelect: (p) => {
      const existente = cart.find((i) => i.productoId === p.id);
      if (existente) {
        if (existente.cantidad + 1 > Number(p.stock)) { toast(`Solo hay ${p.stock} de ${p.nombre}.`, 'danger'); return; }
        existente.cantidad += 1;
      } else {
        if (Number(p.stock) < 1) { toast(`${p.nombre} no tiene stock.`, 'danger'); return; }
        cart.push({ productoId: p.id, nombre: p.nombre, stock: Number(p.stock), cantidad: 1, precio: Number(p.precioVenta), descuento: 0 });
      }
      renderCart();
    },
  });

  // Artículo suelto: se describe y se le pone precio en el momento, sin registrarlo
  // en el catálogo. No toca inventario porque no es un producto con stock.
  const panelLibre = $('v-libre');
  $('v-libre-toggle').addEventListener('click', () => {
    panelLibre.hidden = !panelLibre.hidden;
    if (!panelLibre.hidden) $('v-libre-desc').focus();
  });

  function agregarLibre() {
    const desc = $('v-libre-desc').value.trim();
    const precio = Number($('v-libre-precio').value);
    if (!desc) { toast('Escribe qué vendiste.', 'danger'); $('v-libre-desc').focus(); return; }
    if (!precio || precio <= 0) { toast('Ponle un precio.', 'danger'); $('v-libre-precio').focus(); return; }
    cart.push({ productoId: null, libre: true, nombre: desc, cantidad: 1, precio, descuento: 0 });
    $('v-libre-desc').value = '';
    $('v-libre-precio').value = '';
    $('v-libre-desc').focus();
    renderCart();
  }
  $('v-libre-add').addEventListener('click', agregarLibre);
  ['v-libre-desc', 'v-libre-precio'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); agregarLibre(); } });
  });

  function renderCart() {
    const list = $('v-cart-list');
    if (!cart.length) {
      list.innerHTML = '<span class="text-muted">Todavía no has agregado productos. Búscalos arriba y tócalos para agregarlos.</span>';
      updateTotals();
      return;
    }
    list.innerHTML = cart.map((i, idx) => `
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
      const item = cart[idx];
      const n = Math.max(1, Math.floor(Number(valor) || 1));
      // Los artículos sueltos no tienen stock que controlar.
      if (!item.libre && n > item.stock) { toast(`Solo hay ${item.stock} de ${item.nombre}.`, 'danger'); item.cantidad = item.stock; }
      else item.cantidad = n;
      renderCart();
    };
    list.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { cart.splice(Number(b.dataset.rm), 1); renderCart(); }));
    list.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => setQty(Number(b.dataset.inc), cart[Number(b.dataset.inc)].cantidad + 1)));
    list.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => {
      const idx = Number(b.dataset.dec);
      if (cart[idx].cantidad <= 1) { cart.splice(idx, 1); renderCart(); } else setQty(idx, cart[idx].cantidad - 1);
    }));
    list.querySelectorAll('[data-qty]').forEach((el) => el.addEventListener('change', () => setQty(Number(el.dataset.qty), el.value)));
    list.querySelectorAll('[data-price]').forEach((el) => el.addEventListener('change', () => {
      cart[Number(el.dataset.price)].precio = Math.max(0, Number(el.value) || 0);
      renderCart();
    }));
    updateTotals();
  }

  function computeTotals() {
    // El precio del producto es el precio final: no se suma IVA.
    const subtotal = round2(cart.reduce((s, i) => s + i.cantidad * i.precio, 0));
    const descuento = Math.min(Math.max(0, Number($('v-descuento').value) || 0), subtotal);
    return { subtotal, descuento, iva: 0, total: round2(subtotal - descuento) };
  }

  // ---- Cobro en efectivo --------------------------------------------------
  // El vuelto no se escribe: se toca con cuánto pagó el cliente y el sistema lo
  // saca. Por defecto asume pago justo, así que la venta normal no pide teclear
  // nada. `modoPago` recuerda qué eligió el cajero para que el número siga vivo
  // aunque cambie el total (por un descuento o un producto más).
  let modoPago = 'justo';   // 'justo' | 'billete' | 'otro'
  let montoBillete = 0;

  /**
   * Con cuánto puede pagar el cliente una venta de `total`.
   *
   * En Guatemala el billete más grande es de Q200, y la gente paga redondeando
   * hacia arriba: una venta de Q235 se cubre con Q240, Q250 o Q300, no con una
   * cifra cualquiera. Por eso se ofrecen los redondeos al 10, 20, 50, 100 y 200
   * en vez de una lista fija de billetes que casi nunca calzaría.
   */
  function sugerenciasDePago(total) {
    if (total <= 0) return [];
    const montos = new Set();
    for (const paso of [10, 20, 50, 100, 200]) {
      const monto = Math.ceil(total / paso) * paso;
      if (monto > total) montos.add(monto);
    }
    return [...montos].sort((a, b) => a - b).slice(0, 4);
  }

  function recibidoEnEfectivo(total) {
    if (modoPago === 'justo') return total;
    if (modoPago === 'otro') return Number($('v-recibido').value) || 0;
    return montoBillete;
  }

  function renderBilletes(total) {
    // Si el total subió por encima del billete elegido, ese billete ya no
    // alcanza: se regresa solo a pago justo en vez de dejar una venta que no
    // se puede guardar.
    if (modoPago === 'billete' && montoBillete < total) modoPago = 'justo';
    const cont = $('v-billetes');
    cont.innerHTML = `
      <button type="button" class="billete ${modoPago === 'justo' ? 'activo' : ''}" data-justo>
        Pago justo${total > 0 ? `<span>${formatQ(total)}</span>` : ''}
      </button>
      ${sugerenciasDePago(total).map((m) => `
        <button type="button" class="billete ${modoPago === 'billete' && montoBillete === m ? 'activo' : ''}" data-monto="${m}">
          ${formatQ(m)}
        </button>`).join('')}
      <button type="button" class="billete ${modoPago === 'otro' ? 'activo' : ''}" data-otro>Otro</button>`;

    cont.querySelector('[data-justo]').addEventListener('click', () => { modoPago = 'justo'; updateTotals(); });
    cont.querySelector('[data-otro]').addEventListener('click', () => {
      modoPago = 'otro'; updateTotals(); $('v-recibido').focus();
    });
    cont.querySelectorAll('[data-monto]').forEach((b) => b.addEventListener('click', () => {
      modoPago = 'billete'; montoBillete = Number(b.dataset.monto); updateTotals();
    }));
    $('v-otro-box').style.display = modoPago === 'otro' ? '' : 'none';
  }

  function updateTotals() {
    const { subtotal, descuento, total } = computeTotals();
    $('v-totales').innerHTML = descuento
      ? `<span class="text-muted">Subtotal ${formatQ(subtotal)} − ${formatQ(descuento)}</span><br><b>Total: ${formatQ(total)}</b>`
      : `<b>Total: ${formatQ(total)}</b>`;
    if ($('v-pago').value === 'efectivo') {
      renderBilletes(total);
      const recibido = recibidoEnEfectivo(total);
      const falta = round2(total - recibido);
      const box = $('v-vuelto-box');
      // Solo aparece cuando hay algo que decir: en el pago justo estorba.
      box.hidden = !(total > 0 && (falta > 0 || recibido > total));
      box.className = falta > 0 ? 'vuelto-box falta' : 'vuelto-box';
      box.innerHTML = falta > 0
        ? `Faltan <b>${formatQ(falta)}</b> para cubrir la venta`
        : `Dale de vuelto <b>${formatQ(round2(recibido - total))}</b>`;
    }
    return computeTotals();
  }

  $('v-descuento').addEventListener('input', updateTotals);
  $('v-recibido').addEventListener('input', updateTotals);
  $('v-pago').addEventListener('change', (e) => {
    $('v-pago-efectivo').style.display = e.target.value === 'efectivo' ? '' : 'none';
    $('v-pago-mixto').style.display = e.target.value === 'mixto' ? '' : 'none';
    // El banco se pregunta cuando entra dinero por transferencia: en pago mixto
    // también, porque la parte que no es efectivo pudo llegar por ahí.
    $('v-banco-box').style.display = (e.target.value === 'transferencia' || e.target.value === 'mixto') ? '' : 'none';
    updateTotals();
  });

  $('v-save').addEventListener('click', async () => {
    if (!cart.length) { toast('Agrega al menos un producto.', 'danger'); return; }
    const empleadosComision = selectedEmpleados();
    if (!empleadosComision.length) { toast('Selecciona al menos un empleado que realizó la venta.', 'danger'); return; }
    const { subtotal, descuento, iva, total } = computeTotals();
    const formaPago = $('v-pago').value;
    let montoRecibido = total, vuelto = 0;

    if (formaPago === 'efectivo') {
      montoRecibido = recibidoEnEfectivo(total);
      if (montoRecibido < total) { toast('El monto recibido es menor al total.', 'danger'); return; }
      vuelto = Math.max(0, round2(montoRecibido - total));
    } else if (formaPago === 'mixto') {
      const efectivo = Number($('v-mixto-efectivo').value) || 0;
      const otro = Number($('v-mixto-otro').value) || 0;
      if (round2(efectivo + otro) < total) { toast('La suma de efectivo + tarjeta/transferencia es menor al total.', 'danger'); return; }
      vuelto = Math.max(0, round2(efectivo + otro - total));
      montoRecibido = round2(efectivo + otro);
    }

    // Si el dinero llegó por transferencia hay que saber a qué cuenta entró:
    // ese dinero no pasa por la caja, así que el banco es el único rastro.
    const bancoOpt = $('v-banco').selectedOptions[0];
    const pideBanco = formaPago === 'transferencia' || formaPago === 'mixto';
    if (pideBanco && bancos.length && !bancoOpt.value) {
      toast('Elige a qué banco te hicieron la transferencia.', 'danger');
      $('v-banco').focus(); return;
    }
    // Se guarda el número de cuenta junto al nombre: si mañana esa cuenta se
    // edita o se borra del catálogo, la venta sigue diciendo a dónde entró.
    const banco = pideBanco && bancoOpt.value
      ? { bancoId: bancoOpt.value, bancoNombre: bancoOpt.dataset.nombre, bancoCuenta: bancoOpt.dataset.cuenta || '' }
      : { bancoId: null, bancoNombre: '', bancoCuenta: '' };

    const saveBtn = $('v-save');
    const rotuloBoton = saveBtn.textContent;
    // Guardar una venta grande toma su tiempo: el botón dice en qué va, en vez de
    // quedarse apagado y hacer creer que el sistema se trabó.
    const avisar = (texto) => { saveBtn.textContent = texto; };
    const liberar = () => { saveBtn.disabled = false; saveBtn.textContent = rotuloBoton; };
    saveBtn.disabled = true;
    try {
      // El stock ya NO se revisa aparte. La transacción que descuenta el inventario
      // valida los productos y sus existencias ANTES de escribir nada: si a uno le
      // falta, no se descuenta ninguno y la venta se rechaza entera. Revisarlo antes
      // era pedirle lo mismo a la base dos veces, y con ocho productos eso solo
      // agregaba más de un segundo de espera con el cliente enfrente.
      const delCatalogo = cart.filter((i) => i.productoId);

      const clienteOpt = $('v-cliente').selectedOptions[0];
      const clienteId = clienteOpt.value;
      const clienteNombre = clienteId === 'CF' ? CONSUMIDOR_FINAL.nombre : clienteOpt.dataset.nombre;
      const fechaVenta = $('v-fecha').value || todayISO();
      // El id se genera aquí mismo, así el inventario puede referenciar la venta sin
      // esperar a que el servidor devuelva el id primero.
      const saleId = nuevoId('sales');

      // El inventario va PRIMERO porque es lo único que puede rechazar la venta.
      // Si falla, no se escribió nada: ni la venta, ni la caja, ni se gastó un
      // número de folio (que dejaría un hueco en el correlativo).
      avisar('Descontando del inventario…');
      await applyStockChanges(
        delCatalogo.map((i) => ({ productoId: i.productoId, delta: -i.cantidad, nombre: i.nombre })),
        { motivo: 'venta', referenciaId: saleId, usuario: user, fecha: fechaVenta },
      );

      avisar('Guardando la venta…');
      const numero = await nextFolio('sales', { prefix: 'V', pad: 1 });
      // Solo se registra en caja el efectivo físico que realmente entra al cajón.
      // Tarjeta/transferencia no mueven efectivo, así que no afectan el arqueo.
      const efectivoEnCaja = formaPago === 'efectivo' ? montoRecibido
        : formaPago === 'mixto' ? (Number($('v-mixto-efectivo').value) || 0)
        : 0;
      const responsable = empleadosComision.map((e) => e.empleadoNombre).filter(Boolean).join(', ');

      // La venta y sus dos movimientos de caja no dependen unos de otros: van juntos.
      await Promise.all([
        setRecord('sales', saleId, {
          numero, fecha: fechaVenta, usuarioId: user.uid, usuarioNombre: user.nombre,
          clienteId, clienteNombre, clienteTipo: clienteId === 'CF' ? 'CF' : 'registrado',
          items: cart.map((i) => ({
            productoId: i.productoId ?? null, libre: !!i.libre, nombre: i.nombre, cantidad: i.cantidad,
            precio: i.precio, descuento: 0, subtotal: round2(i.cantidad * i.precio),
          })),
          subtotal, descuentoTotal: descuento,
          iva, total, formaPago, montoRecibido, vuelto, empleadosComision,
          ...banco,
        }),
        efectivoEnCaja > 0
          ? addCashMovement({ tipo: 'entrada', categoria: 'venta', monto: efectivoEnCaja, motivo: `Venta ${numero} — ${clienteNombre}`, referenciaId: saleId, fecha: fechaVenta, responsable })
          : null,
        vuelto > 0
          ? addCashMovement({ tipo: 'salida', categoria: 'vuelto', monto: vuelto, motivo: `Vuelto venta ${numero}`, referenciaId: saleId, fecha: fechaVenta, responsable })
          : null,
      ]);

      toast(`Venta ${numero} registrada.` + (vuelto > 0 ? ` Vuelto: ${formatQ(vuelto)}` : ''), 'success', 5000);
      closeModal();
      if (onSaved) onSaved();
    } catch (err) {
      toast('No se pudo registrar la venta: ' + err.message, 'danger', 7000);
      liberar();
    }
  });

  renderCart();
}
