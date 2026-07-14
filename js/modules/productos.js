import { getAll, addRecord, updateRecord, removeRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, confirmDialog, formValues } from '../ui.js';
import { escapeHtml, formatQ } from '../utils.js';

async function render(container) {
  const [items, allCategories, allBrands] = await Promise.all([
    getAll('products', { order: 'nombre' }),
    getAll('categories', { order: 'nombre' }),
    getAll('brands', { order: 'nombre' }),
  ]);
  const categories = allCategories.filter((c) => c.activo !== false);
  const brands = allBrands.filter((b) => b.activo !== false);

  const lowStockCount = items.filter((p) => Number(p.stock) <= Number(p.stockMinimo ?? 0)).length;

  const table = renderTable({
    columns: [
      { key: 'nombre', label: 'Producto' },
      { key: 'marca', label: 'Marca' },
      { key: 'categoria', label: 'Categoría' },
      { key: 'presentacion', label: 'Presentación' },
      { key: 'precioVenta', label: 'P. Venta', format: (r) => formatQ(r.precioVenta) },
      { key: 'stock', label: 'Stock', format: (r) => {
          const bajo = Number(r.stock) <= Number(r.stockMinimo ?? 0);
          return `<span class="${bajo ? 'badge badge-danger' : ''}">${r.stock ?? 0}${bajo ? ' ⚠' : ''}</span>`;
        } },
      { key: 'estado', label: 'Estado', format: (r) => r.estado === 'inactivo'
          ? `<span class="badge badge-muted">Inactivo</span>` : `<span class="badge badge-success">Activo</span>` },
      { key: 'acciones', label: '', format: (r) => `
          <button class="btn btn-secondary btn-sm" data-edit="${r.id}">Editar</button>
          <button class="btn btn-danger btn-sm" data-del="${r.id}">Eliminar</button>` },
    ],
    rows: items,
    searchKeys: ['nombre', 'marca', 'categoria', 'presentacion'],
    emptyMessage: 'Aún no hay productos registrados.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Nuevo producto</button>`,
  });

  container.innerHTML = `
    ${lowStockCount ? `<div class="card" style="border-color:var(--danger);background:var(--danger-light);margin-bottom:16px">
        ⚠ <b>${lowStockCount}</b> producto(s) con stock igual o por debajo del mínimo.
      </div>` : ''}
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

  function optionList(list, selected) {
    return list.map((c) => `<option value="${escapeHtml(c.nombre)}" ${c.nombre === selected ? 'selected' : ''}>${escapeHtml(c.nombre)}</option>`).join('');
  }

  function openForm(item) {
    openModal(item ? 'Editar producto' : 'Nuevo producto', `
      <form id="prod-form">
        <label>Nombre
          <input name="nombre" required value="${escapeHtml(item?.nombre || '')}">
        </label>
        <div class="form-row">
          <label>Marca
            <select name="marca">${categories.length === 0 && brands.length === 0 ? '' : optionList(brands, item?.marca)}</select>
          </label>
          <label>Categoría
            <select name="categoria">${optionList(categories, item?.categoria)}</select>
          </label>
        </div>
        <div class="form-row">
          <label>Viscosidad
            <input name="viscosidad" placeholder="ej. 5W-30" value="${escapeHtml(item?.viscosidad || '')}">
          </label>
          <label>Presentación
            <input name="presentacion" placeholder="ej. Galón, 1L" value="${escapeHtml(item?.presentacion || '')}">
          </label>
        </div>
        <div class="form-row">
          <label>Precio de compra (Q)
            <input name="precioCompra" type="number" step="0.01" min="0" required value="${item?.precioCompra ?? ''}">
          </label>
          <label>Precio de venta (Q)
            <input name="precioVenta" type="number" step="0.01" min="0" required value="${item?.precioVenta ?? ''}">
          </label>
        </div>
        <div class="form-row">
          <label>Stock actual
            <input name="stock" type="number" step="1" min="0" required value="${item?.stock ?? 0}">
          </label>
          <label>Stock mínimo
            <input name="stockMinimo" type="number" step="1" min="0" required value="${item?.stockMinimo ?? 0}">
          </label>
        </div>
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
    document.getElementById('prod-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const data = {
        nombre: v.nombre.trim(),
        marca: v.marca || '',
        categoria: v.categoria || '',
        viscosidad: v.viscosidad.trim(),
        presentacion: v.presentacion.trim(),
        precioCompra: Number(v.precioCompra),
        precioVenta: Number(v.precioVenta),
        stock: Number(v.stock),
        stockMinimo: Number(v.stockMinimo),
        estado: v.estado,
      };
      try {
        if (item) await updateRecord('products', item.id, data);
        else await addRecord('products', data);
        toast('Producto guardado correctamente.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo guardar: ' + err.message, 'danger');
      }
    });
  }

  async function onDelete(id) {
    const ok = await confirmDialog('¿Eliminar este producto? Esta acción no se puede deshacer.');
    if (!ok) return;
    try {
      await removeRecord('products', id);
      toast('Producto eliminado.', 'success');
      render(container);
    } catch (err) {
      toast('No se pudo eliminar: ' + err.message, 'danger');
    }
  }
}

export default { render };
