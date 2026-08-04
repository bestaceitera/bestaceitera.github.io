import { getAll, addRecord, updateRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, formValues } from '../ui.js';
import { escapeHtml } from '../utils.js';

const ROLE_LABEL = { admin: 'Administrador', empleado: 'Empleado' };

async function render(container) {
  const all = await getAll('users', { order: 'nombre' });
  const cuentas = all.filter((u) => u.tipo !== 'empleado');
  const empleados = all.filter((u) => u.tipo === 'empleado');

  const tablaCuentas = renderTable({
    columns: [
      { key: 'username', label: 'Usuario' },
      { key: 'nombre', label: 'Nombre' },
      { key: 'role', label: 'Rol', format: (r) => `<span class="badge badge-info">${escapeHtml(ROLE_LABEL[r.role] || r.role)}</span>` },
      { key: 'estado', label: 'Estado', format: (r) => r.activo === false
          ? `<span class="badge badge-muted">Inactiva</span>` : `<span class="badge badge-success">Activa</span>` },
      { key: 'acciones', label: '', format: (r) => `<button class="btn btn-secondary btn-sm" data-edit-cuenta="${r.id}">Editar</button>` },
    ],
    rows: cuentas,
    emptyMessage: 'No hay cuentas de acceso.',
  });

  const tablaEmpleados = renderTable({
    columns: [
      { key: 'nombre', label: 'Empleado' },
      { key: 'comision', label: 'Comisión', format: (r) => `${Number(r.comision || 0)}%` },
      { key: 'estado', label: 'Estado', format: (r) => r.activo === false
          ? `<span class="badge badge-muted">Dado de baja</span>` : `<span class="badge badge-success">Activo</span>` },
      { key: 'acciones', label: '', format: (r) => `<button class="btn btn-secondary btn-sm" data-edit-emp="${r.id}">Editar</button>` },
    ],
    rows: empleados,
    searchKeys: ['nombre'],
    emptyMessage: 'Aún no hay empleados registrados.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new-emp">+ Nuevo empleado</button>`,
  });

  container.innerHTML = `
    <div class="section-title" style="margin-top:0">Cuentas de acceso</div>
    <div class="card" style="margin-bottom:8px">
      Son las únicas dos que pueden iniciar sesión: la de <b>administrador</b> (tú) y la de
      <b>empleado</b>, que comparte el personal en el mostrador.
    </div>
    <div class="card" id="card-cuentas">${tablaCuentas.html}</div>

    <div class="section-title">Empleados (para ventas y comisiones)</div>
    <div class="card" style="margin-bottom:8px">
      Estos <b>no inician sesión</b>. Son los nombres que aparecen al registrar una venta u orden
      para saber quién la hizo y calcular su comisión.
    </div>
    <div class="card" id="card-empleados">${tablaEmpleados.html}</div>
  `;

  const cardCuentas = container.querySelector('#card-cuentas');
  const cardEmpleados = container.querySelector('#card-empleados');
  tablaCuentas.mount(cardCuentas);
  tablaEmpleados.mount(cardEmpleados);

  cardEmpleados.querySelector('#btn-new-emp').addEventListener('click', () => openEmpleadoForm());
  cardCuentas.addEventListener('click', (e) => {
    const id = e.target.dataset.editCuenta;
    if (id) openCuentaForm(cuentas.find((u) => u.id === id));
  });
  cardEmpleados.addEventListener('click', (e) => {
    const id = e.target.dataset.editEmp;
    if (id) openEmpleadoForm(empleados.find((u) => u.id === id));
  });

  function openCuentaForm(item) {
    openModal('Editar cuenta de acceso', `
      <form id="cuenta-form">
        <label>Usuario <input value="${escapeHtml(item.username || '')}" disabled></label>
        <label>Nombre para mostrar
          <input name="nombre" required value="${escapeHtml(item.nombre || '')}">
        </label>
        <label>Rol
          <select name="role">
            <option value="empleado" ${item.role === 'empleado' ? 'selected' : ''}>Empleado</option>
            <option value="admin" ${item.role === 'admin' ? 'selected' : ''}>Administrador</option>
          </select>
        </label>
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="activo" style="width:auto" ${item.activo === false ? '' : 'checked'}> Cuenta activa
        </label>
        <p class="text-muted" style="font-size:12.5px">La contraseña la cambia cada quien desde su sesión (menú lateral → Cambiar contraseña).</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    document.getElementById('cuenta-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      try {
        await updateRecord('users', item.id, { nombre: v.nombre.trim(), role: v.role, activo: !!v.activo, tipo: 'cuenta' });
        toast('Cuenta actualizada.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo guardar: ' + err.message, 'danger');
      }
    });
  }

  function openEmpleadoForm(item) {
    openModal(item ? 'Editar empleado' : 'Nuevo empleado', `
      <form id="emp-form">
        <label>Nombre del empleado
          <input name="nombre" required autocomplete="off" placeholder="ej. Carlos" value="${escapeHtml(item?.nombre || '')}">
        </label>
        <label>Comisión por venta/servicio (%)
          <input name="comision" type="number" min="0" max="100" step="0.1" value="${Number(item?.comision || 0)}">
        </label>
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="activo" style="width:auto" ${item?.activo === false ? '' : 'checked'}> Activo
        </label>
        <p class="text-muted" style="font-size:12.5px">
          Si un empleado se va, desmárcalo como activo en vez de borrarlo: así se conserva
          el historial de sus comisiones.
        </p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    document.getElementById('emp-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const data = { nombre: v.nombre.trim(), comision: Number(v.comision) || 0, activo: !!v.activo, tipo: 'empleado' };
      try {
        if (item) await updateRecord('users', item.id, data);
        else await addRecord('users', data);
        toast('Empleado guardado.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo guardar: ' + err.message, 'danger');
      }
    });
  }
}

export default { render };
