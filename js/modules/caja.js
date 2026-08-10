import { getAll, getByDateRange, addRecord, updateRecord } from '../data.js';
import { addCashMovement } from './cajaCore.js';
import { computeExpected } from './cuadreCore.js';
import { renderTable, toast, confirmDialog, formValues, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { escapeHtml, formatQ, formatDateTime, formatDateLong, round2, todayISO } from '../utils.js';
import { getCurrentUser } from '../auth.js';

const CATEGORIA_LABEL = {
  venta: 'Venta', servicio: 'Servicio', abono: 'Abono', otro_ingreso: 'Otro ingreso',
  compra: 'Compra', gasto: 'Gasto', devolucion: 'Devolución a caja', retiro: 'Retiro de caja',
  deposito: 'Depósito bancario', fondo_inicial: 'Fondo inicial', vuelto: 'Vuelto entregado',
};

async function getTodayMovements() {
  // Se piden SOLO los de hoy a la base (antes se traían todos y se filtraban aquí,
  // lo que con los años significaría descargar miles de registros cada vez).
  const hoy = await getAll('cashMovements', { filters: [['fecha', '==', todayISO()]] });
  return hoy.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

/**
 * Dice QUIÉN hizo el movimiento: si viene de una venta u orden, el empleado que
 * la realizó (no la cuenta con la que se registró, que al ser compartida diría
 * siempre lo mismo).
 *
 * El nombre viene guardado dentro del propio movimiento. Antes se descargaban
 * las últimas 400 ventas y 400 órdenes en CADA apertura de Caja solo para
 * averiguarlo: 800 lecturas repetidas, y además fallaba con los movimientos más
 * viejos que esas 400. Los movimientos anteriores a este cambio no traen el
 * campo, así que para esos se usa la cuenta que lo registró.
 */
function responsableDe(m) {
  return m.responsable || m.usuarioNombre || '';
}

async function render(container) {
  container.innerHTML = `
    <div class="toolbar" style="margin-bottom:0">
      <button class="btn btn-secondary btn-sm tab-btn active" data-tab="control">Control de efectivo</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="cuadre">Cuadre diario</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="devoluciones">Devoluciones a caja</button>
      <button class="btn btn-secondary btn-sm tab-btn" data-tab="historial">Historial</button>
    </div>
    <div id="caja-tab-content" class="mt-16"></div>
  `;
  const tabButtons = container.querySelectorAll('.tab-btn');
  const content = container.querySelector('#caja-tab-content');

  function setActiveTab(tab) {
    tabButtons.forEach((b) => {
      const isActive = b.dataset.tab === tab;
      b.classList.toggle('btn-primary', isActive);
      b.classList.toggle('btn-secondary', !isActive);
    });
    const renderers = { control: renderControl, cuadre: renderCuadre, devoluciones: renderDevoluciones, historial: renderHistorial };
    renderers[tab](content);
  }
  tabButtons.forEach((b) => b.addEventListener('click', () => setActiveTab(b.dataset.tab)));
  setActiveTab('control');

  // ---------------- Control de efectivo ----------------
  async function renderControl(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const movements = await getTodayMovements();
    const stats = computeExpected(movements);
    const hasFondo = movements.some((m) => m.categoria === 'fondo_inicial');

    el.innerHTML = `
      <div class="grid grid-4">
        <div class="stat-card"><div class="label">Fondo inicial</div><div class="value">${formatQ(stats.fondoInicial)}</div></div>
        <div class="stat-card"><div class="label">Entró en efectivo hoy${stats.vueltos > 0 ? ' <span class="text-muted" style="font-weight:400">(ya sin vueltos)</span>' : ''}</div><div class="value" style="color:var(--success)">${formatQ(stats.totalEntradas)}</div></div>
        <div class="stat-card"><div class="label">Salió de caja hoy</div><div class="value" style="color:var(--danger)">${formatQ(stats.totalSalidas)}</div></div>
        <div class="stat-card"><div class="label">Dinero esperado en caja</div><div class="value">${formatQ(stats.esperado)}</div></div>
      </div>
      ${!hasFondo ? `
        <div class="card mt-16">
          <b>Aún no se ha registrado el fondo inicial de hoy.</b>
          <form id="fondo-form" class="mt-16">
            <label>Fondo inicial (Q) <input type="number" name="monto" min="0" step="0.01" required></label>
            <button type="submit" class="btn btn-primary">Registrar fondo inicial</button>
          </form>
        </div>` : ''}

      <div class="section-title">Registrar movimiento manual</div>
      <div class="card">
        <form id="mov-form" class="form-row">
          <label>Tipo
            <select name="tipo"><option value="entrada">Entrada (abono / otro ingreso)</option><option value="salida">Salida (retiro / otro gasto)</option></select>
          </label>
          <label>Monto (Q) <input type="number" name="monto" min="0.01" step="0.01" required></label>
        </form>
        <label>Motivo <input id="mov-motivo" placeholder="ej. Abono de cliente, retiro para vuelto..."></label>
        <button type="button" class="btn btn-secondary" id="mov-save">Registrar movimiento</button>
      </div>

      <div class="section-title">Movimientos de hoy</div>
      <div id="mov-today-table"></div>
    `;

    document.getElementById('fondo-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      await addCashMovement({ tipo: 'entrada', categoria: 'fondo_inicial', monto: Number(v.monto), motivo: 'Fondo inicial del día' });
      toast('Fondo inicial registrado.', 'success');
      renderControl(el);
    });

    document.getElementById('mov-save')?.addEventListener('click', async () => {
      const form = document.getElementById('mov-form');
      const v = formValues(form);
      const motivo = document.getElementById('mov-motivo').value.trim();
      if (!v.monto || Number(v.monto) <= 0) { toast('Ingresa un monto válido.', 'danger'); return; }
      if (!motivo) { toast('Ingresa un motivo.', 'danger'); return; }
      await addCashMovement({ tipo: v.tipo, categoria: v.tipo === 'entrada' ? 'otro_ingreso' : 'retiro', monto: Number(v.monto), motivo });
      toast('Movimiento registrado.', 'success');
      renderControl(el);
    });

    const table = renderTable({
      columns: [
        { key: 'hora', label: 'Hora' },
        { key: 'tipo', label: 'Tipo', format: (r) => r.tipo === 'entrada' ? `<span class="badge badge-success">Entrada</span>` : `<span class="badge badge-danger">Salida</span>` },
        { key: 'categoria', label: 'Categoría', format: (r) => escapeHtml(CATEGORIA_LABEL[r.categoria] || r.categoria) },
        { key: 'monto', label: 'Monto', format: (r) => formatQ(r.monto) },
        { key: 'motivo', label: 'Motivo' },
        { key: 'usuarioNombre', label: 'Responsable', format: (r) => escapeHtml(responsableDe(r)) },
      ],
      rows: movements,
      pageSize: 8,
      emptyMessage: 'Sin movimientos hoy.',
    });
    document.getElementById('mov-today-table').innerHTML = `<div class="card">${table.html}</div>`;
    table.mount(document.querySelector('#mov-today-table .card'));
  }

  // ---------------- Cuadre diario ----------------
  async function renderCuadre(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const [movements, closings] = await Promise.all([getTodayMovements(), getAll('cashClosings', { order: 'createdAt', direction: 'desc', max: 200 })]);
    const stats = computeExpected(movements);
    const todayClosing = closings.find((c) => c.fecha === todayISO());

    el.innerHTML = `
      <div class="card">
        <div class="section-title" style="margin-top:0">Resumen del día — ${todayISO()}</div>
        <table style="width:100%">
          <tr><td>Fondo inicial</td><td class="text-right">${formatQ(stats.fondoInicial)}</td></tr>
          <tr><td>Ventas en efectivo</td><td class="text-right">${formatQ(stats.ventas)}</td></tr>
          <tr><td>Servicios en efectivo</td><td class="text-right">${formatQ(stats.servicios)}</td></tr>
          <tr><td>Otros ingresos</td><td class="text-right">${formatQ(stats.otrosIngresos)}</td></tr>
          <tr><td>Compras (efectivo)</td><td class="text-right">− ${formatQ(stats.compras)}</td></tr>
          <tr><td>Gastos</td><td class="text-right">− ${formatQ(stats.gastos)}</td></tr>
          <tr><td>Retiros de caja</td><td class="text-right">− ${formatQ(stats.retiros)}</td></tr>
          <tr><td>Devoluciones a caja</td><td class="text-right">+ ${formatQ(stats.devoluciones)}</td></tr>
          <tr><td>Depósitos realizados</td><td class="text-right">− ${formatQ(stats.depositos)}</td></tr>
          <tr><td>Vueltos entregados</td><td class="text-right">− ${formatQ(stats.vueltos)}</td></tr>
          <tr style="font-weight:700;border-top:1px solid var(--border)"><td>Dinero que debería haber en caja</td><td class="text-right">${formatQ(stats.esperado)}</td></tr>
        </table>
      </div>

      ${todayClosing ? `
        <div class="card mt-16">
          <b>El cuadre de hoy ya se realizó.</b>
          <p>Debía haber ${formatQ(todayClosing.esperado)} · Contaste ${formatQ(todayClosing.contado)}</p>
          <div class="cuadre-aviso ${todayClosing.estado === 'cuadrada' ? 'ok' : todayClosing.estado === 'sobrante' ? 'sobra' : 'falta'}">
            ${todayClosing.estado === 'cuadrada' ? '✓ <b>La caja cuadró exactamente.</b>'
              : todayClosing.estado === 'sobrante' ? `<b>Sobraron ${formatQ(todayClosing.diferencia)}</b>`
              : `<b>Faltaron ${formatQ(Math.abs(todayClosing.diferencia))}</b> — hay que reponerlos a la caja.`}
          </div>
          ${todayClosing.observaciones ? `<p class="text-muted mt-16">${escapeHtml(todayClosing.observaciones)}</p>` : ''}
        </div>` : `
        <div class="card mt-16">
          <div class="section-title" style="margin-top:0">Realizar cuadre de hoy</div>
          <p class="text-muted" style="font-size:13px;margin-top:0">
            Cuenta el dinero que hay físicamente en la caja y escríbelo aquí. El sistema te dice
            al instante si cuadra, falta o sobra.
          </p>
          <label>Dinero contado físicamente (Q)
            <input type="number" id="contado" min="0" step="0.01" placeholder="0.00" required>
          </label>
          <div id="cuadre-aviso"></div>
          <label>Observaciones <textarea id="cuadre-obs" rows="2" placeholder="ej. faltó por vuelto mal dado"></textarea></label>
          <button class="btn btn-primary" id="btn-cuadre">Guardar cuadre</button>
        </div>`}

      <div class="section-title">Historial de cuadres</div>
      <div id="closings-table"></div>
    `;

    // Aviso en vivo: apenas escribe el conteo ya sabe si cuadra, falta o sobra.
    const inputContado = document.getElementById('contado');
    inputContado?.addEventListener('input', () => {
      const aviso = document.getElementById('cuadre-aviso');
      if (inputContado.value === '') { aviso.innerHTML = ''; return; }
      const contado = Number(inputContado.value) || 0;
      const dif = round2(contado - stats.esperado);
      if (dif === 0) {
        aviso.innerHTML = `<div class="cuadre-aviso ok">✓ <b>La caja cuadra exactamente.</b> No falta ni sobra nada.</div>`;
      } else if (dif < 0) {
        aviso.innerHTML = `<div class="cuadre-aviso falta">
          <b>Faltan ${formatQ(Math.abs(dif))}</b><br>
          Deberían haber ${formatQ(stats.esperado)} y contaste ${formatQ(contado)}.
          Hay que reponer <b>${formatQ(Math.abs(dif))}</b> a la caja para que cuadre.</div>`;
      } else {
        aviso.innerHTML = `<div class="cuadre-aviso sobra">
          <b>Sobran ${formatQ(dif)}</b><br>
          Deberían haber ${formatQ(stats.esperado)} y contaste ${formatQ(contado)}.
          Hay que sacar <b>${formatQ(dif)}</b> de la caja o revisar qué venta no se registró.</div>`;
      }
    });

    document.getElementById('btn-cuadre')?.addEventListener('click', async () => {
      const contado = Number(document.getElementById('contado').value);
      if (isNaN(contado) || contado < 0) { toast('Ingresa el dinero contado.', 'danger'); return; }
      const diferencia = round2(contado - stats.esperado);
      const estado = diferencia === 0 ? 'cuadrada' : diferencia > 0 ? 'sobrante' : 'faltante';
      const user = getCurrentUser();
      try {
        await addRecord('cashClosings', {
          fecha: todayISO(), ...stats, contado, diferencia, estado,
          observaciones: document.getElementById('cuadre-obs').value.trim(),
          usuarioId: user.uid, usuarioNombre: user.nombre,
        });
        toast(estado === 'cuadrada' ? '¡Caja cuadrada!' : estado === 'sobrante' ? `Sobrante de ${formatQ(diferencia)}` : `Faltante de ${formatQ(Math.abs(diferencia))}`,
          estado === 'faltante' ? 'danger' : 'success', 6000);
        renderCuadre(el);
      } catch (err) {
        toast('No se pudo guardar el cuadre: ' + err.message, 'danger');
      }
    });

    const table = renderTable({
      columns: [
        { key: 'fecha', label: 'Fecha' },
        { key: 'esperado', label: 'Esperado', format: (r) => formatQ(r.esperado) },
        { key: 'contado', label: 'Contado', format: (r) => formatQ(r.contado) },
        { key: 'diferencia', label: 'Diferencia', format: (r) => formatQ(r.diferencia) },
        { key: 'estado', label: 'Estado', format: (r) => `<span class="badge ${r.estado === 'cuadrada' ? 'badge-success' : r.estado === 'sobrante' ? 'badge-info' : 'badge-danger'}">${escapeHtml(r.estado)}</span>` },
        { key: 'usuarioNombre', label: 'Registrado por' },
      ],
      rows: closings,
      pageSize: 10,
      emptyMessage: 'Sin cuadres registrados.',
    });
    document.getElementById('closings-table').innerHTML = `<div class="card">${table.html}</div>`;
    table.mount(document.querySelector('#closings-table .card'));
  }

  // ---------------- Devoluciones a caja ----------------
  async function renderDevoluciones(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    const returns = await getAll('cashReturns', { order: 'createdAt', direction: 'desc', max: 200 });
    const pendientes = returns.filter((r) => r.estado === 'pendiente');

    el.innerHTML = `
      <div class="card">
        <div class="section-title" style="margin-top:0">Registrar retiro pendiente de devolver</div>
        <p class="text-muted">Si un empleado usa efectivo de caja para una compra menor o gasto imprevisto, regístralo aquí. El monto se descuenta de inmediato del dinero esperado en caja hasta que se devuelva.</p>
        <div class="form-row">
          <label>Monto (Q) <input type="number" id="ret-monto" min="0.01" step="0.01"></label>
          <label>Motivo <input id="ret-motivo" placeholder="ej. Compra de repuesto menor"></label>
        </div>
        <button class="btn btn-secondary" id="ret-save">Registrar retiro</button>
      </div>

      <div class="section-title">Pendientes de devolver ${pendientes.length ? `(${pendientes.length})` : ''}</div>
      <div class="card">
        ${pendientes.length ? pendientes.map((p) => `
          <div class="cart-line">
            <span style="flex:1">${escapeHtml(p.motivo)} — ${escapeHtml(p.usuarioNombre)}</span>
            <b>${formatQ(p.monto)}</b>
            <button class="btn btn-success btn-sm" data-devolver="${p.id}">Marcar como devuelto</button>
          </div>`).join('') : '<span class="text-muted">No hay retiros pendientes de devolver.</span>'}
      </div>

      <div class="section-title">Historial de devoluciones</div>
      <div id="returns-table"></div>
    `;

    document.getElementById('ret-save').addEventListener('click', async () => {
      const monto = Number(document.getElementById('ret-monto').value);
      const motivo = document.getElementById('ret-motivo').value.trim();
      if (!monto || monto <= 0) { toast('Ingresa un monto válido.', 'danger'); return; }
      if (!motivo) { toast('Ingresa un motivo.', 'danger'); return; }
      const user = getCurrentUser();
      try {
        await addRecord('cashReturns', { monto, motivo, estado: 'pendiente', usuarioId: user.uid, usuarioNombre: user.nombre, fecha: todayISO() });
        await addCashMovement({ tipo: 'salida', categoria: 'retiro', monto, motivo: `Retiro pendiente — ${motivo}` });
        toast('Retiro registrado. Queda pendiente de devolver.', 'success');
        renderDevoluciones(el);
      } catch (err) {
        toast('No se pudo registrar: ' + err.message, 'danger');
      }
    });

    el.querySelectorAll('[data-devolver]').forEach((btn) => btn.addEventListener('click', () => onDevolver(btn.dataset.devolver, returns)));

    const table = renderTable({
      columns: [
        { key: 'fecha', label: 'Fecha' },
        { key: 'motivo', label: 'Motivo' },
        { key: 'usuarioNombre', label: 'Registrado por' },
        { key: 'monto', label: 'Monto', format: (r) => formatQ(r.monto) },
        { key: 'estado', label: 'Estado', format: (r) => r.estado === 'devuelto'
            ? `<span class="badge badge-success">Devuelto</span>` : `<span class="badge badge-warning">Pendiente</span>` },
      ],
      rows: returns,
      pageSize: 10,
      emptyMessage: 'Sin registros.',
    });
    document.getElementById('returns-table').innerHTML = `<div class="card">${table.html}</div>`;
    table.mount(document.querySelector('#returns-table .card'));

    async function onDevolver(id, list) {
      const item = list.find((r) => r.id === id);
      const ok = await confirmDialog(`¿Confirmas que se devolvió ${formatQ(item.monto)} a caja por "${item.motivo}"?`);
      if (!ok) return;
      try {
        await updateRecord('cashReturns', id, { estado: 'devuelto', fechaDevolucion: todayISO() });
        await addCashMovement({ tipo: 'entrada', categoria: 'devolucion', monto: item.monto, motivo: `Devolución — ${item.motivo}`, referenciaId: id });
        toast('Devolución registrada.', 'success');
        renderDevoluciones(el);
      } catch (err) {
        toast('No se pudo registrar la devolución: ' + err.message, 'danger');
      }
    }
  }

  // ---------------- Historial completo ----------------
  async function renderHistorial(el) {
    el.innerHTML = '<div class="empty-state">Cargando…</div>';
    // El historial se pide por período (no "los últimos 500"), así que buscar los
    // movimientos de un mes de hace años los muestra todos, no un recorte.
    let rango = applyRangePreset('mes');
    let peticion = 0;
    const primera = await getByDateRange('cashMovements', rango, { max: 1500 });
    let movements = primera.filas;
    const table = renderTable({
      columns: [
        // Se muestra el DÍA AL QUE PERTENECE el movimiento, no la hora en que se
        // tecleó. Al cargar ventas de días pasados, ver la fecha de captura haría
        // pensar que el dinero entró hoy. Si se registró en otro día, se aclara.
        { key: 'fecha', label: 'Día', format: (r) => {
          const dia = r.fecha || (r.createdAt?.toDate ? formatDateTime(r.createdAt).slice(0, 10) : '');
          const capturado = r.createdAt?.toDate ? r.createdAt.toDate() : null;
          const capturadoISO = capturado ? new Date(capturado - capturado.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : null;
          const distinto = capturadoISO && r.fecha && capturadoISO !== r.fecha;
          return `${escapeHtml(formatDateLong(dia))}${r.hora ? ` <span class="text-muted">${escapeHtml(r.hora)}</span>` : ''}` +
            (distinto ? `<br><span class="text-muted" style="font-size:11.5px">registrado después</span>` : '');
        } },
        { key: 'tipo', label: 'Tipo', format: (r) => r.tipo === 'entrada' ? `<span class="badge badge-success">Entrada</span>` : `<span class="badge badge-danger">Salida</span>` },
        { key: 'categoria', label: 'Categoría', format: (r) => escapeHtml(CATEGORIA_LABEL[r.categoria] || r.categoria) },
        { key: 'monto', label: 'Monto', format: (r) => formatQ(r.monto) },
        { key: 'motivo', label: 'Motivo' },
        { key: 'usuarioNombre', label: 'Responsable', format: (r) => escapeHtml(responsableDe(r)) },
      ],
      rows: movements,
      searchKeys: ['motivo', 'usuarioNombre', 'responsable'],
      pageSize: 15,
      emptyMessage: 'No hubo movimientos de caja en las fechas seleccionadas.',
    });
    el.innerHTML = `
      <div class="toolbar" id="cj-fechas" style="margin-bottom:10px">${dateRangePresetButtons({ conAyer: true })}</div>
      <div class="card">${table.html}</div>`;
    const tabla = table.mount(el.querySelector('.card'));
    bindRangeControls(el.querySelector('#cj-fechas'), async (r) => {
      const mio = ++peticion;
      rango = r;
      tabla.refresh([]);
      try {
        const res = await getByDateRange('cashMovements', rango, { max: 1500 });
        if (mio !== peticion) return;
        movements = res.filas;
      } catch (err) {
        if (mio !== peticion) return;
        movements = [];
        toast('No se pudo cargar el historial: ' + err.message, 'danger', 6000);
      }
      tabla.refresh(movements);
    }, { activo: 'mes' });
  }
}

export default { render };
