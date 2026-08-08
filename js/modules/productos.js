import { getAll, addRecord, updateRecord, removeRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, confirmDialog, formValues } from '../ui.js';
import { stockBajoHtml } from './stockBajo.js';
import { escapeHtml, formatQ } from '../utils.js';

async function render(container, profile) {
  const [items, allCategories, allBrands] = await Promise.all([
    getAll('products', { order: 'nombre' }),
    getAll('categories', { order: 'nombre' }),
    getAll('brands', { order: 'nombre' }),
  ]);
  const categories = allCategories.filter((c) => c.activo !== false);
  const brands = allBrands.filter((b) => b.activo !== false);


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
    ${stockBajoHtml(items, { max: 60 })}
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

  function datalistOptions(list) {
    return list.map((c) => `<option value="${escapeHtml(c.nombre)}">`).join('');
  }

  /**
   * Si la marca/categoría escrita todavía no existe en su catálogo, se crea sola.
   * Si por permisos no se pudiera crear, el producto se guarda igual con ese
   * nombre escrito: nunca se pierde el trabajo por un catálogo secundario.
   */
  async function ensureCatalogo(collectionName, existentes, nombre) {
    const limpio = (nombre || '').trim();
    if (!limpio) return '';
    const yaExiste = existentes.some((c) => c.nombre.toLowerCase() === limpio.toLowerCase());
    if (!yaExiste) {
      try {
        await addRecord(collectionName, { nombre: limpio, activo: true });
      } catch (err) {
        console.warn(`No se pudo agregar "${limpio}" a ${collectionName}:`, err.code || err.message);
      }
    }
    return limpio;
  }

  function openForm(item) {
    openModal(item ? 'Editar producto' : 'Nuevo producto', `
      <form id="prod-form">
        <label>Nombre del producto
          <input name="nombre" required autocomplete="off" placeholder="ej. Prodin Car Kool Verde" value="${escapeHtml(item?.nombre || '')}">
        </label>
        <label>Marca
          <input name="marca" list="lista-marcas" autocomplete="off" placeholder="Se llena sola con el nombre" value="${escapeHtml(item?.marca || '')}">
          <datalist id="lista-marcas">${datalistOptions(brands)}</datalist>
        </label>
        <p class="text-muted" id="marca-hint" style="font-size:12.5px;margin:-4px 0 10px"></p>

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
          <label>Avisarme cuando baje a
            <input name="stockMinimo" type="number" step="1" min="0" required value="${item?.stockMinimo ?? 0}">
          </label>
        </div>

        <details class="mas-detalles"${item && (item.categoria || item.viscosidad || item.presentacion || item.estado === 'inactivo') ? ' open' : ''}>
          <summary>Más detalles (opcional)</summary>
          <div class="form-row mt-16">
            <label>Categoría
              <input name="categoria" list="lista-categorias" autocomplete="off" placeholder="Escribe o elige" value="${escapeHtml(item?.categoria || '')}">
              <datalist id="lista-categorias">${datalistOptions(categories)}</datalist>
            </label>
            <label>Presentación
              <input name="presentacion" placeholder="ej. Galón, 1L" value="${escapeHtml(item?.presentacion || '')}">
            </label>
          </div>
          <div class="form-row">
            <label>Viscosidad
              <input name="viscosidad" placeholder="ej. 5W-30" value="${escapeHtml(item?.viscosidad || '')}">
            </label>
            <label>Estado
              <select name="estado">
                <option value="activo" ${item?.estado !== 'inactivo' ? 'selected' : ''}>Activo</option>
                <option value="inactivo" ${item?.estado === 'inactivo' ? 'selected' : ''}>Inactivo</option>
              </select>
            </label>
          </div>
        </details>

        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);

    // La marca se deduce del nombre: al escribir "Prodin Car Kool Verde" se llena "Prodin"
    // sola, sin tener que repetirla. Si el usuario la escribe a mano, se respeta.
    const form = document.getElementById('prod-form');
    const hint = document.getElementById('marca-hint');
    let marcaEditadaAMano = !!item?.marca;

    // Compara por palabras completas: "Prodin Car Kool" reconoce "Prodin",
    // pero "Prodinex" no. Los signos se tratan como espacios.
    const normalizar = (s) => ` ${String(s).toLowerCase().replace(/[^a-záéíóúñ0-9]+/gi, ' ').trim()} `;

    function marcaEnElNombre(nombre) {
      const n = normalizar(nombre);
      // Gana la marca más larga que aparezca, para que "Auto Coolant" le gane a "Auto".
      return brands
        .filter((b) => b.nombre && n.includes(normalizar(b.nombre)))
        .sort((a, b) => b.nombre.length - a.nombre.length)[0]?.nombre || '';
    }

    form.marca.addEventListener('input', () => {
      marcaEditadaAMano = true;
      hint.textContent = '';
    });

    form.nombre.addEventListener('input', () => {
      if (marcaEditadaAMano) return;
      const detectada = marcaEnElNombre(form.nombre.value);
      form.marca.value = detectada;
      hint.textContent = detectada ? `✓ Marca detectada del nombre: ${detectada}` : '';
    });
    document.getElementById('prod-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const [marca, categoria] = await Promise.all([
        ensureCatalogo('brands', allBrands, v.marca),
        ensureCatalogo('categories', allCategories, v.categoria),
      ]);
      const data = {
        nombre: v.nombre.trim(),
        marca,
        categoria,
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
        render(container, profile);
      } catch (err) {
        toast(err.code === 'permission-denied'
          ? 'Tu usuario todavía no tiene permiso para guardar productos. Avísale al administrador.'
          : 'No se pudo guardar: ' + err.message, 'danger', 7000);
      }
    });
  }

  async function onDelete(id) {
    const p = items.find((i) => i.id === id);
    const ok = await confirmDialog(
      `¿Eliminar "${p?.nombre || 'este producto'}" del catálogo?\n\n` +
      (Number(p?.stock) > 0 ? `Ojo: todavía tiene ${p.stock} unidad(es) en stock.\n` : '') +
      `Ya no se podrá vender ni buscar. Las ventas viejas que lo incluyen no cambian.\n\n` +
      `Si solo quieres dejar de venderlo por un tiempo, mejor edítalo y ponlo como "Inactivo".`
    );
    if (!ok) return;
    try {
      await removeRecord('products', id);
      toast('Producto eliminado.', 'success');
      render(container, profile);
    } catch (err) {
      toast(err.code === 'permission-denied'
        ? 'Tu usuario todavía no tiene permiso para eliminar productos. Avísale al administrador.'
        : 'No se pudo eliminar: ' + err.message, 'danger', 7000);
    }
  }
}

export default { render };
