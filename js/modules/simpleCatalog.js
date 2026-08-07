// Fábrica de CRUD para catálogos de un solo campo (nombre + activo): categorías y marcas.
import { getAll, addRecord, updateRecord, removeRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, confirmDialog, formValues } from '../ui.js';
import { escapeHtml } from '../utils.js';

// `genero` decide el artículo de los textos ("Nueva categoría" / "Nuevo modelo"),
// para que los títulos no queden mal escritos si mañana se agrega un catálogo masculino.
export function makeSimpleCatalogModule({ collectionName, singular, plural, genero = 'f' }) {
  const nuevo = genero === 'f' ? 'Nueva' : 'Nuevo';
  const esta = genero === 'f' ? 'esta' : 'este';
  const guardada = genero === 'f' ? 'guardada' : 'guardado';
  const eliminada = genero === 'f' ? 'eliminada' : 'eliminado';
  const registradas = genero === 'f' ? 'registradas' : 'registrados';
  async function render(container) {
    const items = await getAll(collectionName, { order: 'nombre' });
    const table = renderTable({
      columns: [
        { key: 'nombre', label: 'Nombre' },
        { key: 'estado', label: 'Estado', format: (r) => r.activo === false
            ? `<span class="badge badge-muted">Inactivo</span>` : `<span class="badge badge-success">Activo</span>` },
        { key: 'acciones', label: '', format: (r) => `
            <button class="btn btn-secondary btn-sm" data-edit="${r.id}">Editar</button>
            <button class="btn btn-danger btn-sm" data-del="${r.id}">Eliminar</button>` },
      ],
      rows: items,
      searchKeys: ['nombre'],
      emptyMessage: `Aún no hay ${plural.toLowerCase()} ${registradas}.`,
      extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Nuevo</button>`,
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
      openModal(item ? `Editar ${singular}` : `${nuevo} ${singular.toLowerCase()}`, `
        <form id="catalog-form">
          <label>Nombre
            <input name="nombre" required value="${escapeHtml(item?.nombre || '')}">
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
      document.getElementById('catalog-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = formValues(e.target);
        const data = { nombre: v.nombre.trim(), activo: !!v.activo };
        try {
          if (item) await updateRecord(collectionName, item.id, data);
          else await addRecord(collectionName, data);
          toast(`${singular} ${guardada} correctamente.`, 'success');
          closeModal();
          render(container);
        } catch (err) {
          toast('No se pudo guardar: ' + err.message, 'danger');
        }
      });
    }

    async function onDelete(id) {
      const ok = await confirmDialog(`¿Eliminar ${esta} ${singular.toLowerCase()}? Esta acción no se puede deshacer.`);
      if (!ok) return;
      try {
        await removeRecord(collectionName, id);
        toast(`${singular} ${eliminada}.`, 'success');
        render(container);
      } catch (err) {
        toast('No se pudo eliminar: ' + err.message, 'danger');
      }
    }
  }

  return { render };
}
