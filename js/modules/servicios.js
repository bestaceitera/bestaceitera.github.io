import { getAll, addRecord, updateRecord, removeRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, confirmDialog, formValues } from '../ui.js';
import { escapeHtml, formatQ } from '../utils.js';

async function render(container) {
  const items = await getAll('services', { order: 'nombre' });

  const table = renderTable({
    columns: [
      { key: 'nombre', label: 'Servicio' },
      { key: 'precio', label: 'Precio', format: (r) => formatQ(r.precio) },
      { key: 'descripcion', label: 'Descripción' },
      { key: 'estado', label: 'Estado', format: (r) => r.activo === false
          ? `<span class="badge badge-muted">Inactivo</span>` : `<span class="badge badge-success">Activo</span>` },
      { key: 'acciones', label: '', format: (r) => `
          <button class="btn btn-secondary btn-sm" data-edit="${r.id}">Editar</button>
          <button class="btn btn-danger btn-sm" data-del="${r.id}">Eliminar</button>` },
    ],
    rows: items,
    searchKeys: ['nombre', 'descripcion'],
    emptyMessage: 'Aún no hay servicios registrados.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Nuevo servicio</button>`,
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
    openModal(item ? 'Editar servicio' : 'Nuevo servicio', `
      <form id="serv-form">
        <label>Nombre
          <input name="nombre" required value="${escapeHtml(item?.nombre || '')}">
        </label>
        <label>Precio (Q)
          <input name="precio" type="number" step="0.01" min="0" required value="${item?.precio ?? ''}">
        </label>
        <label>Descripción
          <textarea name="descripcion" rows="2">${escapeHtml(item?.descripcion || '')}</textarea>
        </label>
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="activo" style="width:auto" ${item?.activo === false ? '' : 'checked'}> Activo
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    document.getElementById('serv-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const data = { nombre: v.nombre.trim(), precio: Number(v.precio), descripcion: v.descripcion.trim(), activo: !!v.activo };
      try {
        if (item) await updateRecord('services', item.id, data);
        else await addRecord('services', data);
        toast('Servicio guardado correctamente.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo guardar: ' + err.message, 'danger');
      }
    });
  }

  async function onDelete(id) {
    const ok = await confirmDialog('¿Eliminar este servicio? Esta acción no se puede deshacer.');
    if (!ok) return;
    try {
      await removeRecord('services', id);
      toast('Servicio eliminado.', 'success');
      render(container);
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'danger');
    }
  }
}

export default { render };
