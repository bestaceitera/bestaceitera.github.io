import { getAll, addRecord, updateRecord, removeRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, confirmDialog, formValues } from '../ui.js';
import { escapeHtml } from '../utils.js';

export const CONSUMIDOR_FINAL = { id: 'CF', nombre: 'Consumidor Final' };

async function render(container) {
  const items = await getAll('customers', { order: 'nombre' });

  const table = renderTable({
    columns: [
      { key: 'nombre', label: 'Nombre' },
      { key: 'nit', label: 'NIT' },
      { key: 'telefono', label: 'Teléfono' },
      { key: 'correo', label: 'Correo' },
      { key: 'direccion', label: 'Dirección' },
      { key: 'acciones', label: '', format: (r) => `
          <button class="btn btn-secondary btn-sm" data-edit="${r.id}">Editar</button>
          <button class="btn btn-danger btn-sm" data-del="${r.id}">Eliminar</button>` },
    ],
    rows: items,
    searchKeys: ['nombre', 'nit', 'telefono', 'correo'],
    emptyMessage: 'Aún no hay clientes registrados (aparte de Consumidor Final).',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Nuevo cliente</button>`,
  });

  container.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <b>Consumidor Final</b> — se usa por defecto en cada venta y no se guarda en esta lista.
      Registra aquí solo a los clientes que soliciten factura a su nombre.
    </div>
    <div class="card">${table.html}</div>
  `;
  const card = container.querySelector('.card:last-child');
  table.mount(card);

  card.querySelector('#btn-new').addEventListener('click', () => openForm());
  card.addEventListener('click', (e) => {
    const editId = e.target.dataset.edit;
    const delId = e.target.dataset.del;
    if (editId) openForm(items.find((i) => i.id === editId));
    if (delId) onDelete(delId);
  });

  function openForm(item) {
    openModal(item ? 'Editar cliente' : 'Nuevo cliente', `
      <form id="cli-form">
        <label>Nombre
          <input name="nombre" required value="${escapeHtml(item?.nombre || '')}">
        </label>
        <label>NIT
          <input name="nit" value="${escapeHtml(item?.nit || '')}">
        </label>
        <div class="form-row">
          <label>Teléfono
            <input name="telefono" value="${escapeHtml(item?.telefono || '')}">
          </label>
          <label>Correo
            <input name="correo" type="email" value="${escapeHtml(item?.correo || '')}">
          </label>
        </div>
        <label>Dirección
          <input name="direccion" value="${escapeHtml(item?.direccion || '')}">
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    document.getElementById('cli-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const data = { nombre: v.nombre.trim(), nit: v.nit.trim(), telefono: v.telefono.trim(), correo: v.correo.trim(), direccion: v.direccion.trim() };
      try {
        if (item) await updateRecord('customers', item.id, data);
        else await addRecord('customers', data);
        toast('Cliente guardado correctamente.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo guardar: ' + err.message, 'danger');
      }
    });
  }

  async function onDelete(id) {
    const ok = await confirmDialog('¿Eliminar este cliente? Esta acción no se puede deshacer.');
    if (!ok) return;
    try {
      await removeRecord('customers', id);
      toast('Cliente eliminado.', 'success');
      render(container);
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'danger');
    }
  }
}

export default { render };
