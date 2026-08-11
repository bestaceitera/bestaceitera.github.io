// Catálogo de cuentas bancarias.
//
// No usa la fábrica de catálogos simples (marcas, categorías) porque aquí no
// basta el nombre: un negocio puede tener dos cuentas en el mismo banco, y al
// cobrar una transferencia hay que saber a CUÁL entró el dinero.
import { catalogo } from './catalogos.js';
import { getAll, addRecord, updateRecord, removeRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, confirmDialog, formValues } from '../ui.js';
import { escapeHtml } from '../utils.js';

/**
 * Cómo se nombra una cuenta en los selectores y reportes: "Banrural · 3-123-456".
 * Si no tiene número guardado, se queda solo con el banco.
 */
export function etiquetaBanco(b) {
  return b?.numeroCuenta ? `${b.nombre} · ${b.numeroCuenta}` : (b?.nombre || '');
}

/**
 * Lee el catálogo SIN romper la pantalla que lo pide.
 *
 * Si la lectura falla (permisos, sin conexión), devuelve lista vacía en vez de
 * propagar el error: el formulario de venta se usa todo el día y no puede dejar
 * de abrir por un catálogo secundario.
 */
export async function listarBancos() {
  try {
    const bancos = await catalogo('banks', { order: 'nombre' });
    return bancos.filter((b) => b.activo !== false);
  } catch (err) {
    console.warn('No se pudo leer el catálogo de bancos:', err.code || err.message);
    return [];
  }
}

async function render(container) {
  const items = await getAll('banks', { order: 'nombre' });

  const table = renderTable({
    columns: [
      { key: 'nombre', label: 'Banco' },
      { key: 'numeroCuenta', label: 'No. de cuenta', format: (r) => r.numeroCuenta
          ? `<span class="num-cuenta">${escapeHtml(r.numeroCuenta)}</span>`
          : '<span class="text-muted">—</span>' },
      { key: 'tipoCuenta', label: 'Tipo', format: (r) => escapeHtml(r.tipoCuenta || '') },
      { key: 'estado', label: 'Estado', format: (r) => r.activo === false
          ? `<span class="badge badge-muted">Inactivo</span>` : `<span class="badge badge-success">Activo</span>` },
      { key: 'acciones', label: '', format: (r) => `
          <button class="btn btn-secondary btn-sm" data-edit="${r.id}">Editar</button>
          <button class="btn btn-danger btn-sm" data-del="${r.id}">Eliminar</button>` },
    ],
    rows: items,
    searchKeys: ['nombre', 'numeroCuenta', 'tipoCuenta'],
    emptyMessage: 'Aún no hay cuentas registradas. Agrega la primera para poder clasificar las transferencias.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Nueva cuenta</button>`,
  });

  container.innerHTML = `<div class="card">${table.html}</div>`;
  const card = container.querySelector('.card');
  table.mount(card);

  card.querySelector('#btn-new').addEventListener('click', () => openForm());
  card.addEventListener('click', (e) => {
    const editId = e.target.dataset.edit;
    const delId = e.target.dataset.del;
    if (editId) openForm(items.find((i) => i.id === editId));
    if (delId) onDelete(delId);
  });

  function openForm(item) {
    openModal(item ? 'Editar cuenta' : 'Nueva cuenta bancaria', `
      <form id="banco-form">
        <label>Banco
          <input name="nombre" required autocomplete="off" placeholder="ej. Banrural" value="${escapeHtml(item?.nombre || '')}">
        </label>
        <div class="form-row">
          <label>No. de cuenta
            <input name="numeroCuenta" autocomplete="off" placeholder="ej. 3-123-45678" value="${escapeHtml(item?.numeroCuenta || '')}">
          </label>
          <label>Tipo de cuenta
            <select name="tipoCuenta">
              ${['', 'Monetaria', 'Ahorro'].map((t) => `<option value="${t}"${(item?.tipoCuenta || '') === t ? ' selected' : ''}>${t || '— Sin especificar —'}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="text-muted" style="font-size:12.5px;margin-top:0">
          Si tienes dos cuentas en el mismo banco, registra cada una por separado:
          al cobrar una transferencia vas a poder elegir a cuál entró el dinero.
        </p>
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="activo" style="width:auto" ${item?.activo === false ? '' : 'checked'}> Activa
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    document.getElementById('banco-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const data = {
        nombre: v.nombre.trim(),
        numeroCuenta: v.numeroCuenta.trim(),
        tipoCuenta: v.tipoCuenta,
        activo: !!v.activo,
      };
      try {
        if (item) await updateRecord('banks', item.id, data);
        else await addRecord('banks', data);
        toast('Cuenta guardada correctamente.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo guardar: ' + err.message, 'danger');
      }
    });
  }

  async function onDelete(id) {
    const b = items.find((i) => i.id === id);
    const ok = await confirmDialog(
      `¿Eliminar la cuenta ${etiquetaBanco(b)}?\n\n` +
      `Las ventas y depósitos que ya la tienen registrada NO cambian: conservan el ` +
      `nombre y el número tal como estaban. Solo deja de aparecer al registrar cobros nuevos.`
    );
    if (!ok) return;
    try {
      await removeRecord('banks', id);
      toast('Cuenta eliminada.', 'success');
      render(container);
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'danger');
    }
  }
}

export default { render };
