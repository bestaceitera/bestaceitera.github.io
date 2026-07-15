import { config, initializeApp_, authApi, SDK_VERSION } from '../firebase-config.js';
import { getAll, setRecord, updateRecord } from '../data.js';
import { renderTable, openModal, closeModal, toast, formValues } from '../ui.js';
import { escapeHtml } from '../utils.js';
import { usernameToEmail } from '../auth.js';

const ROLE_LABEL = { admin: 'Administrador', empleado: 'Empleado' };

/** Crea un usuario de Firebase Auth en una app secundaria para no cerrar la sesión del admin actual. */
async function createAuthUser(email, password) {
  const secondaryApp = initializeApp_(config, 'usuario-secundario-' + Date.now());
  const secondaryAuth = authApi.getAuth(secondaryApp);
  try {
    const cred = await authApi.createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;
    await authApi.signOut(secondaryAuth);
    return uid;
  } finally {
    const { deleteApp } = await import(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/firebase-app.js`);
    await deleteApp(secondaryApp).catch(() => {});
  }
}

async function render(container) {
  const items = await getAll('users', { order: 'username' });

  const table = renderTable({
    columns: [
      { key: 'username', label: 'Usuario' },
      { key: 'nombre', label: 'Nombre' },
      { key: 'role', label: 'Rol', format: (r) => `<span class="badge badge-info">${escapeHtml(ROLE_LABEL[r.role] || r.role)}</span>` },
      { key: 'comision', label: 'Comisión', format: (r) => `${Number(r.comision || 0)}%` },
      { key: 'estado', label: 'Estado', format: (r) => r.activo === false
          ? `<span class="badge badge-muted">Inactivo</span>` : `<span class="badge badge-success">Activo</span>` },
      { key: 'acciones', label: '', format: (r) => `<button class="btn btn-secondary btn-sm" data-edit="${r.id}">Editar</button>` },
    ],
    rows: items,
    searchKeys: ['username', 'nombre'],
    emptyMessage: 'No hay usuarios.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Nuevo usuario</button>`,
  });

  container.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      Aquí administras quién puede entrar al sistema. El usuario y contraseña se usan tal cual para
      iniciar sesión (no son un correo real).
    </div>
    <div class="card">${table.html}</div>
  `;
  const card = container.querySelector('.card:last-child');
  table.mount(card);

  card.querySelector('#btn-new').addEventListener('click', () => openCreateForm());
  card.addEventListener('click', (e) => {
    const editId = e.target.dataset.edit;
    if (editId) openEditForm(items.find((i) => i.id === editId));
  });

  function openCreateForm() {
    openModal('Nuevo usuario', `
      <form id="user-form">
        <label>Usuario (para iniciar sesión)
          <input name="username" required pattern="[a-zA-Z0-9_.]+" title="Solo letras, números, punto o guion bajo">
        </label>
        <label>Nombre completo
          <input name="nombre" required>
        </label>
        <label>Contraseña
          <input name="password" type="password" minlength="6" required>
        </label>
        <label>Rol
          <select name="role">
            <option value="empleado">Empleado</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label>Comisión por venta/servicio (%)
          <input name="comision" type="number" min="0" max="100" step="0.1" value="0">
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary">Crear usuario</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    document.getElementById('user-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      try {
        const email = usernameToEmail(v.username);
        const uid = await createAuthUser(email, v.password);
        await setRecord('users', uid, { username: v.username.trim().toLowerCase(), nombre: v.nombre.trim(), role: v.role, comision: Number(v.comision) || 0, activo: true });
        toast('Usuario creado correctamente.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo crear el usuario: ' + (err.message || err.code || ''), 'danger');
        submitBtn.disabled = false;
      }
    });
  }

  function openEditForm(item) {
    openModal('Editar usuario', `
      <form id="user-edit-form">
        <label>Usuario
          <input value="${escapeHtml(item.username)}" disabled>
        </label>
        <label>Nombre completo
          <input name="nombre" required value="${escapeHtml(item.nombre || '')}">
        </label>
        <label>Rol
          <select name="role">
            <option value="empleado" ${item.role === 'empleado' ? 'selected' : ''}>Empleado</option>
            <option value="admin" ${item.role === 'admin' ? 'selected' : ''}>Administrador</option>
          </select>
        </label>
        <label>Comisión por venta/servicio (%)
          <input name="comision" type="number" min="0" max="100" step="0.1" value="${Number(item.comision || 0)}">
        </label>
        <label style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="activo" style="width:auto" ${item.activo === false ? '' : 'checked'}> Usuario activo
        </label>
        <p class="text-muted" style="font-size:12.5px">Para cambiar su propia contraseña, cada usuario debe hacerlo desde su sesión (menú de usuario → Cambiar contraseña).</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    document.getElementById('user-edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      try {
        await updateRecord('users', item.id, { nombre: v.nombre.trim(), role: v.role, comision: Number(v.comision) || 0, activo: !!v.activo });
        toast('Usuario actualizado.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo guardar: ' + err.message, 'danger');
      }
    });
  }
}

export default { render };
