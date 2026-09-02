import { getAll, getByDateRange, removeRecord, adjustStockAtomic } from '../data.js';
import { openUsoPropioForm } from './usoPropio.js';
import { openSaleForm } from './ventaForm.js';
import { openEditForm } from './ventaEditar.js';
import { listarBancos } from './bancos.js';
import { cuadrePorFecha } from './cuadreCore.js';
import { calcularPendiente, avisoPendienteHtml } from './pendienteCore.js';
import { tieneBoleta } from './boletas.js';
import { abrirCierreDia, abrirDepositoDia, abrirDepositosDelDia } from './cierreDia.js';
import { openModal, closeModal, toast, confirmDialog, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { escapeHtml, formatQ, round2, formatDateLong } from '../utils.js';

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
  // El servidor no contestó y esto salió de la copia guardada en el navegador.
  let desdeCopiaLocal = false;
  // Estado de cada día: cuánto efectivo quedó, cuánto falta depositar y si ya se
  // cerró. Es lo que permite ver de un vistazo qué días están listos y cuáles no.
  let porDia = new Map();
  let cierres = new Map();
  let anulados = new Map();
  // Los depósitos ya hechos de cada día, con su foto, para poder revisar la
  // boleta aquí mismo en vez de ir a buscarla a Depósitos bancarios.
  let depositosPorDia = new Map();
  // Dinero de TODOS los días que todavía no ha llegado al banco. Se calcula
  // aparte del período que se esté viendo: el pendiente no desaparece porque el
  // filtro diga "hoy".
  let pendiente = { desde: null, dias: [], total: 0 };
  let busqueda = '';
  let pagina = 1;
  let rango = rangoGuardado || applyRangePreset('mes');
  let cargando = false;
  // Si una consulta falla, la pantalla lo dice y ofrece reintentar. Antes se
  // quedaba vacía o cargando y no había salida más que recargar la página.
  let fallo = null;
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
  /**
   * El dinero pendiente de depositar NO depende del período que se esté viendo:
   * es el mismo se mire "hoy" o "este año". Por eso se pide UNA vez al abrir la
   * pantalla y no en cada clic de los botones de fecha.
   *
   * Cuando iba junto con lo demás, cada clic disparaba seis consultas en vez de
   * cuatro; al cambiar rápido de "este mes" a "esta semana" a "hoy" se apilaban
   * y la pantalla se quedaba en "Cargando…" hasta recargar la página.
   */
  async function cargarPendiente() {
    try {
      pendiente = await calcularPendiente();
    } catch (err) {
      // Que falle el aviso de pendiente no debe tumbar la pantalla de ventas.
      pendiente = { desde: null, dias: [], total: 0 };
      console.warn('No se pudo calcular el pendiente de depositar:', err.message);
    }
    if (card.isConnected) pintar();
  }

  async function cargar() {
    const mio = ++peticion;
    cargando = true;
    fallo = null;
    pintar();
    try {
      const [r, movimientos, closings, depos] = await Promise.all([
        getByDateRange('sales', rango, { max: 1500 }),
        getByDateRange('cashMovements', rango, { max: 4000 }),
        getByDateRange('cashClosings', rango, { max: 500 }),
        getByDateRange('deposits', rango, { max: 500 }),
      ]);
      if (mio !== peticion) return;
      depositosPorDia = new Map();
      depos.filas.forEach((d) => {
        if (!depositosPorDia.has(d.fecha)) depositosPorDia.set(d.fecha, []);
        depositosPorDia.get(d.fecha).push(d);
      });
      // Dentro de un mismo día se ordena por hora: la más reciente arriba.
      sales = r.filas.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      truncado = r.truncado;
      desdeCopiaLocal = r.desdeCopiaLocal || movimientos.desdeCopiaLocal || closings.desdeCopiaLocal || depos.desdeCopiaLocal;
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
      desdeCopiaLocal = false;
      porDia = new Map();
      cierres = new Map();
      anulados = new Map();
      depositosPorDia = new Map();
      fallo = err.message || 'no se pudo conectar';
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
    // Se separa lo cobrado en efectivo de lo que entró por transferencia o
    // tarjeta. Sin eso, el total del día se lee como si todo estuviera en el
    // cajón, y no cuadra con lo que hay que depositar.
    const esEfectivo = (v) => v.formaPago !== 'transferencia' && v.formaPago !== 'tarjeta';
    return [...porDia.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([fecha, ventas]) => ({
        fecha,
        efectivo: round2(ventas.filter(esEfectivo).reduce((s, v) => s + Number(v.total || 0), 0)),
        noEfectivo: round2(ventas.filter((v) => !esEfectivo(v)).reduce((s, v) => s + Number(v.total || 0), 0)),
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

    // Lo ya depositado es un botón, no una etiqueta: abre la boleta aquí mismo.
    // Antes había que irse a Depósitos bancarios solo para ver la foto.
    const hechos = depositosPorDia.get(fecha) || [];
    const conFoto = hechos.filter(tieneBoleta).length;
    const verDepositos = hechos.length
      ? `<button class="btn btn-sm chip-estado ok" data-verdepositos="${fecha}"
           title="Ver la boleta del depósito y, si te equivocaste de banco, eliminarlo">
           ✓ Depositado ${formatQ(depositado)} ·
           ${conFoto === hechos.length ? '📷 ver boleta' : conFoto ? `📷 ${conFoto} de ${hechos.length}` : '⚠ sin foto'}
         </button>`
      : '';

    const chipDeposito = falta <= 0.009
      ? (depositado > 0 ? '' : '<span class="chip-estado neutro">Sin efectivo que depositar</span>')
      : `<button class="btn btn-depositar btn-sm" data-deposito="${fecha}">
           🏦 Depositar ${formatQ(falta)}${depositado > 0 ? ' (falta)' : ''}
         </button>`;

    return `<div class="dia-estado">
      <span class="text-muted" title="Solo el dinero de las ventas en efectivo. Las transferencias y la caja chica no entran aquí.">
        Efectivo de las ventas ${formatQ(dia.efectivoDelDia)}${
          depositado > 0.009 ? ` <span class="text-muted">· ya al banco ${formatQ(depositado)}</span>` : ''}</span>
      ${reaperturas > 0 ? `<span class="chip-reabierto" title="Este día se cerró y se volvió a abrir">↻ reabierto ${reaperturas > 1 ? reaperturas + ' veces' : ''}</span>` : ''}
      <span class="spacer"></span>
      ${verDepositos}
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
    if (fallo) {
      card.querySelector('#v-resumen').innerHTML = '';
      card.querySelector('#v-dias').innerHTML = `<div class="empty-state">
        No se pudieron cargar las ventas: ${escapeHtml(fallo)}.<br>
        <button class="btn btn-primary mt-16" id="v-reintentar">Reintentar</button>
      </div>`;
      card.querySelector('#v-paginacion').innerHTML = '';
      card.querySelector('#v-reintentar').addEventListener('click', cargar);
      return;
    }
    const filtradas = filtrar();
    const dias = agruparPorDia(filtradas);
    const totalPaginas = Math.max(1, Math.ceil(dias.length / DIAS_POR_PAGINA));
    if (pagina > totalPaginas) pagina = totalPaginas;
    const visibles = dias.slice((pagina - 1) * DIAS_POR_PAGINA, pagina * DIAS_POR_PAGINA);

    const totalPeriodo = round2(filtradas.reduce((s, v) => s + Number(v.total || 0), 0));
    const esTodo = rango.from === '2000-01-01';
    card.querySelector('#v-resumen').innerHTML = avisoPendienteHtml(pendiente) + (filtradas.length ? `
      <div class="periodo-resumen">
        <span>${esTodo ? 'Todas las ventas' : `Del ${escapeHtml(rango.from)} al ${escapeHtml(rango.to)}`}</span>
        <span>${filtradas.length} venta${filtradas.length === 1 ? '' : 's'} en ${dias.length} día${dias.length === 1 ? '' : 's'}
          · <b>Total: ${formatQ(totalPeriodo)}</b></span>
      </div>` : '')
      // Si el período pedido tiene más ventas de las que caben, hay que decirlo:
      // un total incompleto mostrado como completo desajustaría la contabilidad.
      // Se dice que son datos guardados, en vez de mostrarlos como si vinieran del
      // servidor. Si el empleado registró una venta desde otro aparato hace un
      // minuto, puede que todavía no esté aquí, y eso hay que avisarlo.
      + (desdeCopiaLocal ? `<div class="alert alert-warning mt-16">
          <b>Mostrando la copia guardada en este navegador.</b><br>
          El servidor no contestó a tiempo, así que puede faltar lo más reciente.
          Cuando vuelva la señal se actualiza solo; también puedes recargar la página.
        </div>` : '')
      + (truncado ? `<div class="alert alert-warning mt-16">Este período tiene más de 1,500 ventas, así que se están mostrando las más recientes.
          El total de abajo <b>no incluye</b> las más antiguas: elige un período más corto para verlo completo.</div>` : '');

    const cont = card.querySelector('#v-dias');
    cont.innerHTML = dias.length ? visibles.map((d) => `
      <div class="dia-grupo">
        <div class="dia-header">
          <span class="dia-fecha">${escapeHtml(formatDateLong(d.fecha))}</span>
          <span class="dia-resumen">${d.ventas.length} venta${d.ventas.length === 1 ? '' : 's'} · <b>${formatQ(d.total)}</b>${
            // El desglose se muestra SIEMPRE, aunque no haya nada en banco. Antes se
            // escondía cuando todo era efectivo, y entonces la ausencia de la línea se
            // leía como "se rompió" en vez de "no hubo transferencias". Un renglón que
            // desaparece sin explicación cuesta más que uno que se repite.
            d.noEfectivo > 0
              ? `<br><span class="dia-desglose">${formatQ(d.efectivo)} en efectivo + ${formatQ(d.noEfectivo)} a banco</span>`
              : '<br><span class="dia-desglose">todo en efectivo</span>'}</span>
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
  card.querySelector('#btn-new').addEventListener('click', () => openSaleForm({ onSaved: () => render(container, profile) }));

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
    const boton = e.target.closest('[data-view], [data-cierre], [data-deposito], [data-verdepositos]');
    if (!boton) return;
    const { view, cierre, deposito, verdepositos } = boton.dataset;
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
    } else if (verdepositos) {
      abrirDepositosDelDia({ fecha: verdepositos, depositos: depositosPorDia.get(verdepositos) || [], onSaved: cargar });
    }
  });
  cargarPendiente();
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
    document.getElementById('v-editar').addEventListener('click', () =>
      openEditForm(s, { profile, onSaved: () => render(container, profile) }));
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

}

export default { render };
