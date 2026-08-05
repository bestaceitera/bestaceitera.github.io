import { getAll, addRecord } from '../data.js';
import { addCashMovement } from './cajaCore.js';
import { renderTable, openModal, closeModal, toast, formValues } from '../ui.js';
import { formatQ, todayISO } from '../utils.js';
import { getCurrentUser } from '../auth.js';

const CATEGORIAS = ['Agua', 'Luz', 'Internet', 'Papelería', 'Limpieza', 'Sueldos', 'Compras menores', 'Otro'];

async function render(container) {
  const expenses = await getAll('expenses', { order: 'createdAt', direction: 'desc', max: 500 });

  const table = renderTable({
    columns: [
      { key: 'fecha', label: 'Fecha' },
      { key: 'categoria', label: 'Categoría' },
      { key: 'descripcion', label: 'Descripción' },
      { key: 'monto', label: 'Monto', format: (r) => formatQ(r.monto) },
      { key: 'usuarioNombre', label: 'Usuario' },
    ],
    rows: expenses,
    searchKeys: ['categoria', 'descripcion', 'usuarioNombre'],
    emptyMessage: 'Aún no hay gastos registrados.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Registrar gasto</button>`,
  });

  container.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat-card"><div class="label">Total gastos registrados</div><div class="value">${formatQ(expenses.reduce((s, e) => s + e.monto, 0))}</div></div>
    </div>
    <div class="card">${table.html}</div>
  `;
  const card = container.querySelector('.card');
  table.mount(card);

  card.querySelector('#btn-new').addEventListener('click', openForm);

  function openForm() {
    openModal('Registrar gasto', `
      <form id="gasto-form">
        <div class="form-row">
          <label>Categoría
            <select name="categoria">${CATEGORIAS.map((c) => `<option value="${c}">${c}</option>`).join('')}</select>
          </label>
          <label>Fecha <input type="date" name="fecha" value="${todayISO()}"></label>
        </div>
        <label>Descripción <input name="descripcion" required></label>
        <label>Monto (Q) <input type="number" name="monto" min="0.01" step="0.01" required></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    document.getElementById('gasto-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const user = getCurrentUser();
      try {
        const expenseId = await addRecord('expenses', {
          categoria: v.categoria, descripcion: v.descripcion.trim(), monto: Number(v.monto),
          fecha: v.fecha || todayISO(), usuarioId: user.uid, usuarioNombre: user.nombre,
        });
        await addCashMovement({ tipo: 'salida', categoria: 'gasto', monto: Number(v.monto), motivo: `${v.categoria} — ${v.descripcion.trim()}`, referenciaId: expenseId });
        toast('Gasto registrado.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo registrar: ' + err.message, 'danger');
      }
    });
  }
}

export default { render };
