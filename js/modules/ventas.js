import { getAll, getById, getByDateRange, addRecord, updateRecord, removeRecord, nextFolio, adjustStockAtomic } from '../data.js';
import { applyStockChange } from './inventoryCore.js';
import { openUsoPropioForm } from './usoPropio.js';
import { listarBancos, etiquetaBanco } from './bancos.js';
import { cuadrePorFecha } from './cuadreCore.js';
import { abrirCierreDia, abrirDepositoDia } from './cierreDia.js';
import { addCashMovement } from './cajaCore.js';
import { openModal, closeModal, toast, confirmDialog, productSearch, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { escapeHtml, formatQ, round2, todayISO, formatDateLong } from '../utils.js';
import { getCurrentUser } from '../auth.js';
import { CONSUMIDOR_FINAL } from './clientes.js';

const DIAS_POR_PAGINA = 7;

// El período elegido se guarda fuera de render() para que sobreviva a los
// refrescos automáticos: si entra una venta desde el mostrador mientras el
// administrador revisa "Este año", la pantalla se actualiza sin saltar a otro mes.
let rangoGuardado = null;
let presetGuardado = 'mes';

async function render(container, profile) {
  // Ventas es del mostrador: el empleado registra, corrige y anula igual que el
  // administrador. Es él quien atiende y quien se da cuenta de un error al
  // instante, así que no tiene sentido que dependa del dueño para arreglarlo.
  //
  // Las ventas se piden POR PERÍODO a la base, no "las últimas N". Así el total
  // que se muestra es siempre el total real de las fechas elegidas, aunque el
  // negocio lleve años acumulando ventas, y la pantalla solo descarga el período
  // que se está viendo.
  let sales = [];
  let truncado = false;
  // Estado de cada día: cuánto efectivo quedó, cuánto falta depositar y si ya se
  // cerró. Es lo que permite ver de un vistazo qué días están listos y cuáles no.
  let porDia = new Map();
  let cierres = new Map();
  let anulados = new Map();
  let busqueda = '';
  let pagina = 1;
  let rango = rangoGuardado || applyRangePreset('mes');
  let cargando = false;
  let peticion = 0;

  container.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <input type="search" class="search-box" id="v-buscar" placeholder="Buscar por No., cliente o empleado...">
        <div class="spacer"></div>
        <button class="btn btn-secondary btn-sm" id="btn-uso-propio">− Para uso propio</button>
        <button class="btn btn-primary btn-sm" id="btn-new">+ Nueva venta</button>
      </div>
      <div class="toolbar" id="v-filtros" style="margin-top:10px">${dateRangePresetButtons({ conAyer: true })}</div>
      <div id="v-resumen"></div>
      <div id="v-dias"><div class="empty-state">Cargando…</div></div>
      <div class="pagination" id="v-paginacion"></div>
    </div>`;
  const card = container.querySelector('.card');

  /**
   * Pide a la base solo las ventas del período elegido. Si mientras llega la
   * respuesta el usuario cambia de filtro, la respuesta vieja se descarta: nunca
   * se pinta un período encima de otro.
   */
  async function cargar() {
    const mio = ++peticion;
    cargando = true;
    pintar();
    try {
      const [r, movimientos, closings] = await Promise.all([
        getByDateRange('sales', rango, { max: 1500 }),
        getByDateRange('cashMovements', rango, { max: 4000 }),
        getByDateRange('cashClosings', rango, { max: 500 }),
      ]);
      if (mio !== peticion) return;
      // Dentro de un mismo día se ordena por hora: la más reciente arriba.
      sales = r.filas.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      truncado = r.truncado;
      porDia = cuadrePorFecha(movimientos.filas);
      // Un cierre anulado (día reabierto) no cuenta como cerrado, pero se guarda
      // para saber cuántas veces costó cuadrar ese día.
      cierres = new Map(closings.filas.filter((c) => !c.anulado).map((c) => [c.fecha, c]));
      anulados = new Map();
      closings.filas.filter((c) => c.anulado).forEach((c) => anulados.set(c.fecha, (anulados.get(c.fecha) || 0) + 1));
    } catch (err) {
      if (mio !== peticion) return;
      sales = [];
      truncado = false;
      porDia = new Map();
      cierres = new Map();
      anulados = new Map();
      toast('No se pudieron cargar las ventas: ' + err.message, 'danger', 6000);
    } finally {
      if (mio === peticion) { cargando = false; pintar(); }
    }
  }

  /** Agrupa las ventas por fecha, de la más reciente a la más antigua. */
  function agruparPorDia(lista) {
    const porDia = new Map();
    lista.forEach((s) => {
      const dia = s.fecha || 'sin fecha';
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia).push(s);
    });
    return [...porDia.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([fecha, ventas]) => ({
        fecha,
        ventas,
        total: round2(ventas.reduce((s, v) => s + Number(v.total || 0), 0)),
      }));
  }

  // Las fechas ya vienen filtradas por la base; aquí solo se aplica el buscador.
  function filtrar() {
    const q = busqueda.trim().toLowerCase();
    if (!q) return sales;
    return sales.filter((s) => {
      const empleados = (s.empleadosComision || []).map((e) => e.empleadoNombre).join(' ');
      return `${s.numero} ${s.clienteNombre || ''} ${empleados}`.toLowerCase().includes(q);
    });
  }

  /**
   * Barra de estado de un día: si ya se cerró y si ya se depositó su efectivo.
   * La idea es ver de un vistazo qué días están listos y cuáles siguen pendientes,
   * sin tener que entrar a Caja ni a Reportes.
   */
  function estadoDelDia(fecha) {
    const dia = porDia.get(fecha);
    const cierre = cierres.get(fecha);
    // Sin movimientos de efectivo no hay nada que cerrar ni depositar (por
    // ejemplo, un día en que todo se cobró por transferencia).
    if (!dia) return '';

    const falta = dia.aDepositar;
    const depositado = dia.depositado;

    const reaperturas = anulados.get(fecha) || 0;
    const chipCierre = cierre
      ? `<button class="btn btn-sm chip-estado ok" data-cierre="${fecha}">
           ✓ Día cerrado${cierre.estado !== 'cuadrada' ? ` · ${cierre.estado === 'sobrante' ? 'sobró' : 'faltó'} ${formatQ(Math.abs(cierre.diferencia))}` : ''}
         </button>`
      : `<button class="btn btn-cerrar-dia btn-sm" data-cierre="${fecha}">
           ${reaperturas > 0 ? 'Volver a cerrar' : 'Cerrar día'}
         </button>`;

    const chipDeposito = falta <= 0.009
      ? (depositado > 0
          ? `<span class="chip-estado ok">✓ Depositado ${formatQ(depositado)}</span>`
          : `<span class="chip-estado neutro">Sin efectivo que depositar</span>`)
      : `<button class="btn btn-depositar btn-sm" data-deposito="${fecha}">
           🏦 Depositar ${formatQ(falta)}${depositado > 0 ? ' (falta)' : ''}
         </button>`;

    return `<div class="dia-estado">
      <span class="text-muted">En caja ${formatQ(dia.enCaja)} · caja chica ${formatQ(dia.cajaChica)}</span>
      ${reaperturas > 0 ? `<span class="chip-reabierto" title="Este día se cerró y se volvió a abrir">↻ reabierto ${reaperturas > 1 ? reaperturas + ' veces' : ''}</span>` : ''}
      <span class="spacer"></span>
      ${chipDeposito}
      ${chipCierre}
    </div>`;
  }

  function pintar() {
    // Si el usuario cambió de pantalla mientras llegaban las ventas, esta tarjeta
    // ya salió del documento: pintar aquí reventaría sin que nadie lo viera.
    if (!card.isConnected) return;
    if (cargando) {
      card.querySelector('#v-resumen').innerHTML = '';
      card.querySelector('#v-dias').innerHTML = '<div class="empty-state">Cargando…</div>';
      card.querySelector('#v-paginacion').innerHTML = '';
      return;
    }
    const filtradas = filtrar();
    const dias = agruparPorDia(filtradas);
    const totalPaginas = Math.max(1, Math.ceil(dias.length / DIAS_POR_PAGINA));
    if (pagina > totalPaginas) pagina = totalPaginas;
    const visibles = dias.slice((pagina - 1) * DIAS_POR_PAGINA, pagina * DIAS_POR_PAGINA);

    const totalPeriodo = round2(filtradas.reduce((s, v) => s + Number(v.total || 0), 0));
    const esTodo = rango.from === '2000-01-01';
    card.querySelector('#v-resumen').innerHTML = (filtradas.length ? `
      <div class="periodo-resumen">
        <span>${esTodo ? 'Todas las ventas' : `Del ${escapeHtml(rango.from)} al ${escapeHtml(rango.to)}`}</span>
        <span>${filtradas.length} venta${filtradas.length === 1 ? '' : 's'} en ${dias.length} día${dias.length === 1 ? '' : 's'}
          · <b>Total: ${formatQ(totalPeriodo)}</b></span>
      </div>` : '')
      // Si el período pedido tiene más ventas de las que caben, hay que decirlo:
      // un total incompleto mostrado como completo desajustaría la contabilidad.
      + (truncado ? `<div class="alert alert-warning mt-16">Este período tiene más de 1,500 ventas, así que se están mostrando las más recientes.
          El total de abajo <b>no incluye</b> las más antiguas: elige un período más corto para verlo completo.</div>` : '');

    const cont = card.querySelector('#v-dias');
    cont.innerHTML = dias.length ? visibles.map((d) => `
      <div class="dia-grupo">
        <div class="dia-header">
          <span class="dia-fecha">${escapeHtml(formatDateLong(d.fecha))}</span>
          <span class="dia-resumen">${d.ventas.length} venta${d.ventas.length === 1 ? '' : 's'} · <b>${formatQ(d.total)}</b></span>
        </div>
        ${estadoDelDia(d.fecha)}
        <div class="table-wrap"><table>
          <thead><tr><th>No.</th><th>Cliente</th><th>Pago</th><th>Total</th><th>Realizada por</th><th></th></tr></thead>
          <tbody>${d.ventas.map((s) => `<tr>
            <td>${escapeHtml(s.numero)}</td>
            <td>${escapeHtml(s.clienteNombre || '')}</td>
            <td><span class="badge badge-info">${escapeHtml(s.formaPago)}</span>${s.bancoNombre ? `<br><span class="text-muted" style="font-size:11.5px">${escapeHtml(s.bancoNombre)}</span>` : ''}</td>
            <td>${formatQ(s.total)}</td>
            <td>${escapeHtml((s.empleadosComision || []).map((e) => e.empleadoNombre).join(', ')) || '<span class="text-muted">—</span>'}</td>
            <td><button class="btn btn-secondary btn-sm" data-view="${s.id}">Ver detalle</button></td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>`).join('')
      : `<div class="table-empty" style="padding:30px">${
          busqueda ? 'Ninguna venta del período coincide con la búsqueda. Prueba con “Todo” para buscar en todo el historial.'
          : esTodo ? 'Aún no hay ventas registradas.'
          : 'No hubo ventas en las fechas seleccionadas.'}</div>`;

    const pag = card.querySelector('#v-paginacion');
    pag.innerHTML = dias.length
      ? `<span class="text-muted">${dias.length} día(s) con ventas</span>
         <button class="btn btn-secondary btn-sm" data-act="prev" ${pagina <= 1 ? 'disabled' : ''}>‹</button>
         <span class="text-muted">Página ${pagina} / ${totalPaginas}</span>
         <button class="btn btn-secondary btn-sm" data-act="next" ${pagina >= totalPaginas ? 'disabled' : ''}>›</button>`
      : '';
    pag.querySelector('[data-act="prev"]')?.addEventListener('click', () => { pagina--; pintar(); });
    pag.querySelector('[data-act="next"]')?.addEventListener('click', () => { pagina++; pintar(); });
  }

  card.querySelector('#v-buscar').addEventListener('input', (e) => { busqueda = e.target.value; pagina = 1; pintar(); });
  bindRangeControls(card.querySelector('#v-filtros'), (r, preset) => {
    rango = r; rangoGuardado = r; presetGuardado = preset;
    pagina = 1; cargar();
  }, { activo: presetGuardado });
  card.querySelector('#btn-new').addEventListener('click', openSaleForm);

  // Sacar producto sin venderlo se hace desde el mostrador, que es donde ocurre.
  // El catálogo se pide en el momento del clic para no cargarlo si no se usa.
  card.querySelector('#btn-uso-propio').addEventListener('click', async () => {
    const [products, users] = await Promise.all([
      getAll('products', { order: 'nombre' }),
      getAll('users', { order: 'nombre' }),
    ]);
    const empleados = users.filter((u) => u.tipo === 'empleado' && u.activo !== false);
    openUsoPropioForm({ products, empleados, onSaved: () => render(container, profile) });
  });
  card.addEventListener('click', (e) => {
    const boton = e.target.closest('[data-view], [data-cierre], [data-deposito]');
    if (!boton) return;
    const { view, cierre, deposito } = boton.dataset;
    if (view) {
      const venta = sales.find((s) => s.id === view);
      if (venta) viewDetail(venta);
    } else if (cierre) {
      abrirCierreDia({ fecha: cierre, dia: porDia.get(cierre), cierre: cierres.get(cierre),
        cierresPrevios: anulados.get(cierre) || 0, onSaved: cargar });
    } else if (deposito) {
      listarBancos().then((bancos) => {
        abrirDepositoDia({ fecha: deposito, dia: porDia.get(deposito), bancos, onSaved: cargar });
      });
    }
  });
  await cargar();

  function viewDetail(s) {
    openModal(`Venta ${s.numero}`, `
      <p><b>Cliente:</b> ${escapeHtml(s.clienteNombre)} &nbsp; <b>Fecha:</b> ${escapeHtml(s.fecha)} &nbsp; <b>Registró:</b> ${escapeHtml(s.usuarioNombre)}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Producto</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr></thead>
        <tbody>${s.items.map((i) => `<tr><td>${escapeHtml(i.nombre)}${i.libre ? ' <span class="badge badge-info">suelto</span>' : ''}</td><td>${i.cantidad}</td><td>${formatQ(i.precio)}</td><td>${formatQ(i.subtotal)}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="mt-16 text-right">${s.iva > 0 ? `IVA (12%): ${formatQ(s.iva)}<br>` : ''}${s.descuentoTotal > 0 ? `Subtotal: ${formatQ(s.subtotal)}<br>Descuento: −${formatQ(s.descuentoTotal)}<br>` : ''}<b>Total: ${formatQ(s.total)}</b></p>
      <p><b>Forma de pago:</b> ${escapeHtml(s.formaPago)}${s.bancoNombre ? ` — <b>${escapeHtml(s.bancoNombre)}</b>${s.bancoCuenta ? ` <span class="num-cuenta">${escapeHtml(s.bancoCuenta)}</span>` : ''}` : ''} ${s.formaPago !== 'transferencia' && s.formaPago !== 'tarjeta' ? `— Recibido ${formatQ(s.montoRecibido)}, Vuelto ${formatQ(s.vuelto)}` : ''}</p>
      <p><b>Empleados:</b> ${(s.empleadosComision || []).map((e) => escapeHtml(e.empleadoNombre)).join(', ') || 'N/A'}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="v-editar">Editar</button>
        <button class="btn btn-danger" id="v-eliminar">Eliminar venta</button>
      </div>
    `);
    document.getElementById('v-editar').addEventListener('click', () => openEditForm(s));
    document.getElementById('v-eliminar').addEventListener('click', () => eliminarVenta(s));
  }

  /**
   * Al eliminar una venta se deshace TODO lo que provocó: devuelve el stock,
   * quita su entrada y su vuelto de la caja y borra su rastro del historial de
   * inventario. Queda como si nunca se hubiera registrado.
   */
  async function eliminarVenta(s) {
    const conStock = (s.items || []).filter((i) => i.productoId);
    const ok = await confirmDialog(
      `¿Eliminar la venta ${s.numero} de ${formatQ(s.total)}?\n\n` +
      `Se va a deshacer todo:\n` +
      (conStock.length ? `• Devolver al inventario: ${conStock.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')}\n` : '• No hay stock que devolver (artículos sueltos)\n') +
      `• Quitar de la caja lo que entró y el vuelto de esta venta\n\n` +
      `Esta acción no se puede deshacer.`
    );
    if (!ok) return;
    try {
      // 1) Devolver el stock. Va en transacción por lo mismo que al vender: si en
      //    ese instante alguien más está vendiendo ese producto, sumar sobre un
      //    dato ya viejo perdería una de las dos operaciones. No se registra un
      //    movimiento de devolución porque la venta va a desaparecer: el objetivo
      //    es dejar todo como si nunca se hubiera registrado.
      for (const item of conStock) {
        try {
          await adjustStockAtomic(item.productoId, Number(item.cantidad || 0));
        } catch (err) {
          // El producto pudo haberse borrado del catálogo después de la venta:
          // eso no debe impedir eliminarla ni deshacer la caja.
          console.warn('devolver stock', item.nombre, err.message);
        }
      }
      // 2) Quitar de la caja y del historial solo lo ligado a ESTA venta
      //    (se pregunta por su referencia, sin descargar las colecciones enteras).
      const [movsCaja, movsInv] = await Promise.all([
        getAll('cashMovements', { filters: [['referenciaId', '==', s.id]] }),
        getAll('inventoryMovements', { filters: [['referenciaId', '==', s.id]] }),
      ]);
      for (const m of movsCaja) await removeRecord('cashMovements', m.id);
      for (const m of movsInv) await removeRecord('inventoryMovements', m.id);
      await removeRecord('sales', s.id);
      toast(`Venta ${s.numero} eliminada. Stock y caja quedaron como antes.`, 'success', 6000);
      closeModal();
      render(container, profile);
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'danger', 6000);
    }
  }

  /** Solo se editan los datos que NO mueven dinero ni inventario. */
  async function openEditForm(s) {
    const users = await getAll('users', { order: 'nombre' });
    const empleados = users.filter((u) => u.tipo === 'empleado' && u.activo !== false);
    const customers = await getAll('customers', { order: 'nombre' });
    const yaAsignados = new Set((s.empleadosComision || []).map((e) => e.empleadoId));

    openModal(`Editar venta ${s.numero}`, `
      <div class="card" style="background:var(--primary-light);border-color:var(--primary);margin-bottom:14px">
        Aquí se corrigen <b>cliente, fecha y quién realizó la venta</b>. Para cambiar productos,
        precios o el monto, elimina la venta y regístrala de nuevo (así el inventario y la caja
        se recalculan bien).
      </div>
      <div class="form-row">
        <label>Cliente
          <select id="ed-cliente">
            <option value="CF" ${s.clienteId === 'CF' ? 'selected' : ''}>Consumidor Final</option>
            ${customers.map((c) => `<option value="${c.id}" data-nombre="${escapeHtml(c.nombre)}" ${s.clienteId === c.id ? 'selected' : ''}>${escapeHtml(c.nombre)}</option>`).join('')}
          </select>
        </label>
        <label>Fecha de la venta
          <input type="date" id="ed-fecha" value="${escapeHtml(s.fecha || todayISO())}" max="${todayISO()}">
        </label>
      </div>
      <div class="section-title">¿Quién realizó esta venta?</div>
      <div class="tag-list" id="ed-empleados">
        ${empleados.map((u) => `<label class="chip" style="cursor:pointer">
            <input type="checkbox" value="${u.id}" data-nombre="${escapeHtml(u.nombre)}" data-comision="${u.comision || 0}" style="width:auto" ${yaAsignados.has(u.id) ? 'checked' : ''}> ${escapeHtml(u.nombre)}
          </label>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="cancel-form">Cancelar</button>
        <button class="btn btn-primary" id="ed-guardar">Guardar cambios</button>
      </div>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    document.getElementById('ed-guardar').addEventListener('click', async () => {
      const marcados = [...document.querySelectorAll('#ed-empleados input:checked')].map((el) => ({
        empleadoId: el.value, empleadoNombre: el.dataset.nombre, comisionPct: Number(el.dataset.comision) || 0,
      }));
      if (!marcados.length) { toast('Selecciona al menos un empleado.', 'danger'); return; }
      const opt = document.getElementById('ed-cliente').selectedOptions[0];
      const nuevaFecha = document.getElementById('ed-fecha').value || s.fecha;
      try {
        await updateRecord('sales', s.id, {
          clienteId: opt.value,
          clienteNombre: opt.value === 'CF' ? CONSUMIDOR_FINAL.nombre : opt.dataset.nombre,
          clienteTipo: opt.value === 'CF' ? 'CF' : 'registrado',
          fecha: nuevaFecha,
          empleadosComision: marcados,
        });
        // Si cambió la fecha, sus movimientos de caja deben moverse al mismo día
        // para que el cuadre de cada día siga cuadrando.
        if (nuevaFecha !== s.fecha) {
          const movs = await getAll('cashMovements', { filters: [['referenciaId', '==', s.id]] });
          for (const m of movs) {
            await updateRecord('cashMovements', m.id, { fecha: nuevaFecha });
          }
        }
        toast('Venta actualizada.', 'success');
        closeModal();
        render(container, profile);
      } catch (err) {
        toast('No se pudo guardar: ' + err.message, 'danger');
      }
    });
  }

  async function openSaleForm() {
    const [products, customers, users, bancos] = await Promise.all([
      getAll('products', { order: 'nombre' }),
      getAll('customers', { order: 'nombre' }),
      getAll('users', { order: 'nombre' }),
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
      <div id="v-pago-efectivo" class="form-row">
        <label>Monto recibido (Q) <input type="number" id="v-recibido" min="0" step="0.01"></label>
        <label>Vuelto <input type="text" id="v-vuelto" value="Q 0.00" disabled></label>
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

    function updateTotals() {
      const { subtotal, descuento, total } = computeTotals();
      $('v-totales').innerHTML = descuento
        ? `<span class="text-muted">Subtotal ${formatQ(subtotal)} − ${formatQ(descuento)}</span><br><b>Total: ${formatQ(total)}</b>`
        : `<b>Total: ${formatQ(total)}</b>`;
      if ($('v-pago').value === 'efectivo') {
        const recibido = Number($('v-recibido').value) || 0;
        // Sin nada que cobrar no hay vuelto que entregar.
        $('v-vuelto').value = formatQ(total > 0 ? Math.max(0, round2(recibido - total)) : 0);
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
      saveBtn.disabled = true;
      try {
        // Se revisa el stock contra la base justo antes de guardar: si otro
        // dispositivo vendió lo mismo mientras este formulario estaba abierto,
        // la venta se rechaza entera en vez de dejar el inventario en negativo.
        for (const item of cart.filter((i) => i.productoId)) {
          const actual = await getById('products', item.productoId);
          if (!actual) {
            toast(`El producto "${item.nombre}" ya no existe. Quítalo de la venta.`, 'danger', 6000);
            saveBtn.disabled = false; return;
          }
          if (Number(actual.stock || 0) < item.cantidad) {
            toast(`Ya solo quedan ${actual.stock || 0} de "${item.nombre}". Ajusta la cantidad.`, 'danger', 6000);
            saveBtn.disabled = false; return;
          }
        }

        const clienteOpt = $('v-cliente').selectedOptions[0];
        const clienteId = clienteOpt.value;
        const clienteNombre = clienteId === 'CF' ? CONSUMIDOR_FINAL.nombre : clienteOpt.dataset.nombre;
        const numero = await nextFolio('sales', { prefix: 'V', pad: 1 });
        const fechaVenta = $('v-fecha').value || todayISO();

        const saleId = await addRecord('sales', {
          numero, fecha: fechaVenta, usuarioId: user.uid, usuarioNombre: user.nombre,
          clienteId, clienteNombre, clienteTipo: clienteId === 'CF' ? 'CF' : 'registrado',
          items: cart.map((i) => ({
            productoId: i.productoId ?? null, libre: !!i.libre, nombre: i.nombre, cantidad: i.cantidad,
            precio: i.precio, descuento: 0, subtotal: round2(i.cantidad * i.precio),
          })),
          subtotal, descuentoTotal: descuento,
          iva, total, formaPago, montoRecibido, vuelto, empleadosComision,
          ...banco,
        });

        // Los artículos sueltos no están en el catálogo, así que no descuentan inventario.
        for (const item of cart.filter((i) => i.productoId)) {
          await applyStockChange(item.productoId, -item.cantidad, { motivo: 'venta', referenciaId: saleId, usuario: user });
        }

        // Solo se registra en caja el efectivo físico que realmente entra al cajón.
        // Tarjeta/transferencia no mueven efectivo, así que no afectan el arqueo de caja.
        const efectivoEnCaja = formaPago === 'efectivo' ? montoRecibido
          : formaPago === 'mixto' ? (Number($('v-mixto-efectivo').value) || 0)
          : 0;
        const responsable = empleadosComision.map((e) => e.empleadoNombre).filter(Boolean).join(', ');
        if (efectivoEnCaja > 0) {
          await addCashMovement({ tipo: 'entrada', categoria: 'venta', monto: efectivoEnCaja, motivo: `Venta ${numero} — ${clienteNombre}`, referenciaId: saleId, fecha: fechaVenta, responsable });
        }
        if (vuelto > 0) {
          await addCashMovement({ tipo: 'salida', categoria: 'vuelto', monto: vuelto, motivo: `Vuelto venta ${numero}`, referenciaId: saleId, fecha: fechaVenta, responsable });
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
