// Editar una venta ya registrada.
//
// Hay dos niveles a propósito:
//
//   - Cliente, fecha y quién vendió: los corrige CUALQUIERA. Son datos que no
//     mueven dinero, y el del mostrador es quien nota el error al instante.
//   - Los MONTOS: solo el administrador. Cambiar un precio cambia el total, el
//     vuelto, la entrada de caja y el arqueo del día. Eso no es corregir un
//     dato, es mover dinero, y tiene que ser decisión del dueño.
//
// Ocultarle los campos al empleado no basta: las reglas de Firestore también lo
// impiden (ver firestore.rules, match /sales), porque si no, bastaría con abrir
// la consola del navegador para cambiar un total desde la cuenta de empleado.
import { getAll, updateRecord, removeRecord } from '../data.js';
import { addCashMovement } from './cajaCore.js';
import { openModal, closeModal, toast } from '../ui.js';
import { escapeHtml, formatQ, round2, todayISO } from '../utils.js';
import { CONSUMIDOR_FINAL } from './clientes.js';

/** Las formas de pago que NO mueven efectivo en el cajón. */
const SIN_EFECTIVO = new Set(['transferencia', 'tarjeta']);

/**
 * Cuánto efectivo entró de verdad al cajón por esta venta.
 *
 * En pago mixto la parte en efectivo se pregunta en el formulario pero NO se
 * guarda en la venta, así que aquí no se puede recalcular: por eso el mixto no
 * deja editar montos (se avisa en pantalla en vez de inventar un número).
 */
function efectivoDeLaVenta(formaPago, montoRecibido) {
  return SIN_EFECTIVO.has(formaPago) ? 0 : round2(montoRecibido);
}

/**
 * Deja la caja diciendo lo mismo que la venta: ajusta, crea o borra la entrada
 * de efectivo y la salida del vuelto según los montos nuevos.
 *
 * Se borra el movimiento cuando el monto queda en cero (por ejemplo, se corrige
 * un vuelto que no existía). Dejarlo en Q0 ensuciaría el arqueo con líneas que
 * no dicen nada.
 */
async function sincronizarCaja(venta, { efectivo, vuelto, fecha }) {
  const movs = await getAll('cashMovements', { filters: [['referenciaId', '==', venta.id]] });
  const entrada = movs.find((m) => m.tipo === 'entrada' && m.categoria === 'venta');
  const salida = movs.find((m) => m.tipo === 'salida' && m.categoria === 'vuelto');
  const responsable = (venta.empleadosComision || []).map((e) => e.empleadoNombre).filter(Boolean).join(', ');

  if (efectivo > 0.009) {
    if (entrada) await updateRecord('cashMovements', entrada.id, { monto: efectivo, fecha });
    else await addCashMovement({ tipo: 'entrada', categoria: 'venta', monto: efectivo, fecha, responsable,
      motivo: `Venta ${venta.numero} — ${venta.clienteNombre}`, referenciaId: venta.id });
  } else if (entrada) {
    await removeRecord('cashMovements', entrada.id);
  }

  if (vuelto > 0.009) {
    if (salida) await updateRecord('cashMovements', salida.id, { monto: vuelto, fecha });
    else await addCashMovement({ tipo: 'salida', categoria: 'vuelto', monto: vuelto, fecha, responsable,
      motivo: `Vuelto venta ${venta.numero}`, referenciaId: venta.id });
  } else if (salida) {
    await removeRecord('cashMovements', salida.id);
  }
}

export async function openEditForm(s, { profile, onSaved }) {
  const esAdmin = profile?.role === 'admin';
  // El mixto no guarda cuánto fue en efectivo, así que sus montos no se pueden
  // recalcular sin adivinar. Se dice, en vez de dejar el campo mintiendo.
  const puedeMontos = esAdmin && s.formaPago !== 'mixto';
  const mueveEfectivo = !SIN_EFECTIVO.has(s.formaPago);

  const [users, customers] = await Promise.all([
    getAll('users', { order: 'nombre' }),
    getAll('customers', { order: 'nombre' }),
  ]);
  const empleados = users.filter((u) => u.tipo === 'empleado' && u.activo !== false);
  const yaAsignados = new Set((s.empleadosComision || []).map((e) => e.empleadoId));
  const items = (s.items || []).map((i) => ({ ...i }));

  const filasMontos = items.map((i, n) => `
    <tr>
      <td>${escapeHtml(i.nombre)}${i.libre ? ' <span class="badge badge-info">suelto</span>' : ''}</td>
      <td class="text-right">${i.cantidad}</td>
      <td><input type="number" class="ed-precio" data-n="${n}" min="0" step="0.01"
                 value="${Number(i.precio) || 0}" style="width:110px;text-align:right"></td>
      <td class="text-right" data-sub="${n}">${formatQ(i.subtotal)}</td>
    </tr>`).join('');

  openModal(`Editar venta ${s.numero}`, `
    <div class="card" style="background:var(--primary-light);border-color:var(--primary);margin-bottom:14px">
      ${puedeMontos
        ? `Puedes corregir <b>los precios</b> y <b>cuánto pagó el cliente</b>. El total, el vuelto y la
           caja del día se recalculan solos.<br>
           Para cambiar <b>cantidades o qué producto se vendió</b>, elimina la venta y regístrala de
           nuevo: eso mueve inventario y hay que rehacerlo completo.`
        : s.formaPago === 'mixto'
          ? `Esta venta se cobró en <b>pago mixto</b> y no quedó guardado cuánto fue en efectivo, así que
             el monto no se puede recalcular sin adivinar. Para corregirla, elimínala y regístrala de nuevo.`
          : `Aquí se corrigen <b>cliente, fecha y quién realizó la venta</b>. Los montos solo los cambia
             el administrador.`}
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

    ${puedeMontos ? `
      <div class="section-title">Montos</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Producto</th><th class="text-right">Cant.</th><th>Precio</th><th class="text-right">Subtotal</th></tr></thead>
        <tbody>${filasMontos}</tbody>
      </table></div>
      <div class="form-row" style="align-items:flex-end">
        ${mueveEfectivo ? `<label>Con cuánto pagó el cliente (Q)
          <input type="number" id="ed-recibido" min="0" step="0.01" value="${Number(s.montoRecibido) || 0}">
        </label>` : '<div></div>'}
        <div class="text-right" style="padding-bottom:6px">
          <div>Total: <b id="ed-total">${formatQ(s.total)}</b></div>
          ${mueveEfectivo ? `<div>Vuelto: <b id="ed-vuelto">${formatQ(s.vuelto || 0)}</b></div>` : ''}
        </div>
      </div>
      <div id="ed-aviso"></div>
    ` : ''}

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

  const $ = (id) => document.getElementById(id);
  $('cancel-form').addEventListener('click', closeModal);

  /** Recalcula en vivo mientras se teclea, para que nadie guarde a ciegas. */
  function recalcular() {
    if (!puedeMontos) return { total: s.total, recibido: s.montoRecibido, vuelto: s.vuelto || 0, ok: true };
    document.querySelectorAll('.ed-precio').forEach((el) => {
      const n = Number(el.dataset.n);
      items[n].precio = Math.max(0, Number(el.value) || 0);
      items[n].subtotal = round2(items[n].cantidad * items[n].precio);
      const celda = document.querySelector(`[data-sub="${n}"]`);
      if (celda) celda.textContent = formatQ(items[n].subtotal);
    });
    const subtotal = round2(items.reduce((a, i) => a + i.subtotal, 0));
    const descuento = Math.min(Number(s.descuentoTotal) || 0, subtotal);
    const total = round2(subtotal - descuento);
    const recibido = mueveEfectivo ? Math.max(0, Number($('ed-recibido')?.value) || 0) : total;
    const vuelto = round2(recibido - total);
    if ($('ed-total')) $('ed-total').textContent = formatQ(total);
    if ($('ed-vuelto')) $('ed-vuelto').textContent = formatQ(Math.max(0, vuelto));
    const ok = !mueveEfectivo || vuelto >= -0.009;
    if ($('ed-aviso')) {
      $('ed-aviso').innerHTML = ok ? '' :
        `<div class="alert alert-warning">Con ${formatQ(recibido)} no alcanza para una venta de ${formatQ(total)}.
         Corrige el precio o lo que pagó el cliente.</div>`;
    }
    return { subtotal, descuento, total, recibido, vuelto: Math.max(0, vuelto), ok };
  }
  document.querySelectorAll('.ed-precio').forEach((el) => el.addEventListener('input', recalcular));
  $('ed-recibido')?.addEventListener('input', recalcular);

  $('ed-guardar').addEventListener('click', async () => {
    const marcados = [...document.querySelectorAll('#ed-empleados input:checked')].map((el) => ({
      empleadoId: el.value, empleadoNombre: el.dataset.nombre, comisionPct: Number(el.dataset.comision) || 0,
    }));
    if (!marcados.length) { toast('Selecciona al menos un empleado.', 'danger'); return; }
    const calc = recalcular();
    if (!calc.ok) { toast('El monto recibido no cubre el total.', 'danger'); return; }

    const opt = $('ed-cliente').selectedOptions[0];
    const nuevaFecha = $('ed-fecha').value || s.fecha;
    const boton = $('ed-guardar');
    boton.disabled = true;
    try {
      const cambios = {
        clienteId: opt.value,
        clienteNombre: opt.value === 'CF' ? CONSUMIDOR_FINAL.nombre : opt.dataset.nombre,
        clienteTipo: opt.value === 'CF' ? 'CF' : 'registrado',
        fecha: nuevaFecha,
        empleadosComision: marcados,
      };

      const cambioElMonto = puedeMontos && Math.abs(calc.total - Number(s.total || 0)) > 0.009;
      if (puedeMontos) {
        Object.assign(cambios, {
          items, subtotal: calc.subtotal, descuentoTotal: calc.descuento, iva: 0,
          total: calc.total, montoRecibido: calc.recibido, vuelto: calc.vuelto,
        });
        if (cambioElMonto) {
          // Queda constancia de que este total no es el original y de quién lo
          // cambió. Un monto corregido sin rastro es indistinguible de un monto
          // mal registrado desde el principio.
          cambios.totalOriginal = s.totalOriginal ?? Number(s.total || 0);
          cambios.editadoPor = profile?.nombre || profile?.username || 'Administrador';
          cambios.editadoEn = new Date().toISOString().slice(0, 16).replace('T', ' ');
        }
      }
      await updateRecord('sales', s.id, cambios);

      // El rastro sigue a la venta: si cambió la fecha se mueven los movimientos
      // de caja Y los de inventario, para que ni el arqueo ni el kardex queden
      // apuntando a un día en el que no pasó nada.
      if (nuevaFecha !== s.fecha) {
        for (const coleccion of ['cashMovements', 'inventoryMovements']) {
          const movs = await getAll(coleccion, { filters: [['referenciaId', '==', s.id]] });
          for (const m of movs) await updateRecord(coleccion, m.id, { fecha: nuevaFecha });
        }
      }
      if (puedeMontos) {
        await sincronizarCaja({ ...s, empleadosComision: marcados, clienteNombre: cambios.clienteNombre }, {
          efectivo: efectivoDeLaVenta(s.formaPago, calc.recibido),
          vuelto: calc.vuelto,
          fecha: nuevaFecha,
        });
      }

      toast(cambioElMonto
        ? `Venta ${s.numero} actualizada: ${formatQ(s.total)} → ${formatQ(calc.total)}. La caja del día se ajustó.`
        : 'Venta actualizada.', 'success', 5000);
      closeModal();
      if (onSaved) onSaved();
    } catch (err) {
      boton.disabled = false;
      toast('No se pudo guardar: ' + err.message, 'danger', 6000);
    }
  });
}
