import { getAll, addRecord, updateRecord, removeRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, confirmDialog, formValues } from '../ui.js';
import { escapeHtml } from '../utils.js';

async function render(container) {
  const items = await getAll('suppliers', { order: 'empresa' });

  const table = renderTable({
    columns: [
      { key: 'empresa', label: 'Empresa' },
      { key: 'nombreContacto', label: 'Contacto' },
      { key: 'nit', label: 'NIT' },
      { key: 'telefono', label: 'Teléfono' },
      { key: 'correo', label: 'Correo' },
      { key: 'estado', label: 'Estado', format: (r) => r.estado === 'inactivo'
          ? `<span class="badge badge-muted">Inactivo</span>` : `<span class="badge badge-success">Activo</span>` },
      { key: 'acciones', label: '', format: (r) => `
          <button class="btn btn-secondary btn-sm" data-edit="${r.id}">Editar</button>
          <button class="btn btn-danger btn-sm" data-del="${r.id}">Eliminar</button>` },
    ],
    rows: items,
    searchKeys: ['empresa', 'nombreContacto', 'nit', 'telefono', 'correo'],
    emptyMessage: 'Aún no hay proveedores registrados.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Nuevo proveedor</button>`,
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
    openModal(item ? 'Editar proveedor' : 'Nuevo proveedor', `
      <form id="prov-form">
        <div class="form-row">
          <label>Empresa
            <input name="empresa" required value="${escapeHtml(item?.empresa || '')}">
          </label>
          <label>Nombre de contacto
            <input name="nombreContacto" value="${escapeHtml(item?.nombreContacto || '')}">
          </label>
        </div>
        <div class="form-row">
          <label>NIT
            <input name="nit" value="${escapeHtml(item?.nit || '')}">
          </label>
          <label>Teléfono
            <input name="telefono" value="${escapeHtml(item?.telefono || '')}">
          </label>
        </div>
        <label>Correo
          <input name="correo" type="email" value="${escapeHtml(item?.correo || '')}">
        </label>
        <label>Dirección
          <input name="direccion" value="${escapeHtml(item?.direccion || '')}">
        </label>
        <label>Estado
          <select name="estado">
            <option value="activo" ${item?.estado !== 'inactivo' ? 'selected' : ''}>Activo</option>
            <option value="inactivo" ${item?.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>
          </select>
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    document.getElementById('prov-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const data = {
        empresa: v.empresa.trim(), nombreContacto: v.nombreContacto.trim(), nit: v.nit.trim(),
        telefono: v.telefono.trim(), correo: v.correo.trim(), direccion: v.direccion.trim(), estado: v.estado,
      };
      try {
        if (item) await updateRecord('suppliers', item.id, data);
        else await addRecord('suppliers', data);
        toast('Proveedor guardado correctamente.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo guardar: ' + err.message, 'danger');
      }
    });
  }

  async function onDelete(id) {
    const ok = await confirmDialog('¿Eliminar este proveedor? Esta acción no se puede deshacer.');
    if (!ok) return;
    try {
      await removeRecord('suppliers', id);
      toast('Proveedor eliminado.', 'success');
      render(container);
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'danger');
    }
  }
}

export default { render };
