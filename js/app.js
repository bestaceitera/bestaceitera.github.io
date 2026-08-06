import { isConfigured } from './firebase-config.js';
import { login, logout, onAuthChange, friendlyAuthError, changeOwnPassword } from './auth.js';
import { registerRoute, initRouter, stopRouter } from './router.js';
import { toast, openModal, closeModal, formValues } from './ui.js';
import { getAll, addRecord } from './data.js';
import { escapeHtml } from './utils.js';

import dashboard from './modules/dashboard.js';
import ventas from './modules/ventas.js';
import ordenesServicio from './modules/ordenesServicio.js';
import servicios from './modules/servicios.js';
import clientes from './modules/clientes.js';
import caja from './modules/caja.js';
import depositos from './modules/depositos.js';
import inventario from './modules/inventario.js';
import productos from './modules/productos.js';
import compras from './modules/compras.js';
import proveedores from './modules/proveedores.js';
import categorias from './modules/categorias.js';
import marcas from './modules/marcas.js';
import gastos from './modules/gastos.js';
import reportes from './modules/reportes.js';
import usuarios from './modules/usuarios.js';

registerRoute({ hash: 'dashboard', label: 'Dashboard', icon: '📊', section: 'Principal', render: dashboard.render });
registerRoute({ hash: 'ventas', label: 'Ventas', icon: '🧾', section: 'Operación', render: ventas.render });
registerRoute({ hash: 'ordenes-servicio', label: 'Órdenes de servicio', icon: '🔧', section: 'Operación', render: ordenesServicio.render });
registerRoute({ hash: 'clientes', label: 'Clientes', icon: '👥', section: 'Operación', render: clientes.render });
registerRoute({ hash: 'caja', label: 'Caja', icon: '💰', section: 'Operación', render: caja.render });
registerRoute({ hash: 'depositos', label: 'Depósitos bancarios', icon: '🏦', section: 'Operación', render: depositos.render });

registerRoute({ hash: 'inventario', label: 'Inventario', icon: '📦', section: 'Almacén', roles: ['admin'], render: inventario.render });
registerRoute({ hash: 'productos', label: 'Productos', icon: '🛢️', section: 'Almacén', render: productos.render });
registerRoute({ hash: 'categorias', label: 'Categorías', icon: '🏷️', section: 'Almacén', render: categorias.render });
registerRoute({ hash: 'marcas', label: 'Marcas', icon: '⭐', section: 'Almacén', render: marcas.render });
registerRoute({ hash: 'servicios', label: 'Catálogo de servicios', icon: '🧰', section: 'Almacén', roles: ['admin'], render: servicios.render });

registerRoute({ hash: 'compras', label: 'Compras', icon: '🛒', section: 'Administración', roles: ['admin'], render: compras.render });
registerRoute({ hash: 'proveedores', label: 'Proveedores', icon: '🚚', section: 'Administración', roles: ['admin'], render: proveedores.render });
registerRoute({ hash: 'gastos', label: 'Gastos', icon: '💸', section: 'Administración', roles: ['admin'], render: gastos.render });
registerRoute({ hash: 'reportes', label: 'Reportes', icon: '📈', section: 'Administración', roles: ['admin'], render: reportes.render });
registerRoute({ hash: 'usuarios', label: 'Usuarios', icon: '🔑', section: 'Administración', roles: ['admin'], render: usuarios.render });

const SEED_CATEGORIES = ['Aceites', 'Filtros', 'Aditivos', 'Lubricantes', 'Refrigerantes'];
const SEED_BRANDS = ['Shell', 'Mobil', 'Castrol', 'Valvoline', 'Liqui Moly'];
const SEED_SERVICES = [
  { nombre: 'Cambio de aceite', precio: 50, descripcion: '' },
  { nombre: 'Cambio de filtro', precio: 30, descripcion: '' },
  { nombre: 'Afinación', precio: 150, descripcion: '' },
  { nombre: 'Cambio de refrigerante', precio: 60, descripcion: '' },
  { nombre: 'Lavado de motor', precio: 80, descripcion: '' },
  { nombre: 'Revisión', precio: 25, descripcion: '' },
];

async function seedIfEmpty() {
  try {
    const [cats, brands, servs] = await Promise.all([getAll('categories'), getAll('brands'), getAll('services')]);
    if (cats.length === 0) for (const nombre of SEED_CATEGORIES) await addRecord('categories', { nombre, activo: true });
    if (brands.length === 0) for (const nombre of SEED_BRANDS) await addRecord('brands', { nombre, activo: true });
    if (servs.length === 0) for (const s of SEED_SERVICES) await addRecord('services', { ...s, activo: true });
  } catch (err) {
    console.warn('No se pudo sembrar catálogos iniciales (puede que ya existan o falten permisos):', err.message);
  }
}

function showLoginView() {
  stopRouter(); // suelta las escuchas en vivo antes de quedarse sin sesión
  document.getElementById('login-view').hidden = false;
  document.getElementById('app-view').hidden = true;
}

function showAppView(profile) {
  document.getElementById('login-view').hidden = true;
  document.getElementById('app-view').hidden = false;
  document.getElementById('sidebar-user').innerHTML = `<b>${escapeHtml(profile.nombre)}</b>${profile.role === 'admin' ? 'Administrador' : 'Empleado'}`;
  initRouter(profile);
}

function bindChrome() {
  document.getElementById('btn-menu')?.addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    stopRouter(); // primero se sueltan las escuchas, luego se cierra la sesión
    await logout();
    showLoginView();
  });

  const footer = document.querySelector('.sidebar-footer');
  const changePassBtn = document.createElement('button');
  changePassBtn.className = 'btn btn-ghost btn-block';
  changePassBtn.style.marginBottom = '8px';
  changePassBtn.textContent = 'Cambiar contraseña';
  changePassBtn.addEventListener('click', openChangePasswordModal);
  footer.insertBefore(changePassBtn, document.getElementById('btn-logout'));
}

function openChangePasswordModal() {
  openModal('Cambiar contraseña', `
    <form id="pass-form">
      <label>Contraseña actual <input type="password" name="actual" required></label>
      <label>Nueva contraseña <input type="password" name="nueva" minlength="6" required></label>
      <label>Confirmar nueva contraseña <input type="password" name="confirmar" minlength="6" required></label>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
        <button type="submit" class="btn btn-primary">Cambiar contraseña</button>
      </div>
    </form>
  `);
  document.getElementById('cancel-form').addEventListener('click', closeModal);
  document.getElementById('pass-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(e.target);
    if (v.nueva !== v.confirmar) { toast('Las contraseñas nuevas no coinciden.', 'danger'); return; }
    try {
      await changeOwnPassword(v.actual, v.nueva);
      toast('Contraseña actualizada correctamente.', 'success');
      closeModal();
    } catch (err) {
      toast('No se pudo cambiar la contraseña: ' + (err.message || err.code || ''), 'danger');
    }
  });
}

function init() {
  bindChrome();

  if (!isConfigured) {
    document.getElementById('login-error').hidden = false;
    document.getElementById('login-error').textContent = 'El sistema aún no está conectado a la base de datos. Falta configurar js/firebase-config.js.';
    document.getElementById('login-form').querySelector('button[type="submit"]').disabled = true;
    return;
  }

  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('login-error');
    errorEl.hidden = true;
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await login(username, password);
    } catch (err) {
      errorEl.textContent = friendlyAuthError(err);
      errorEl.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  onAuthChange(async (profile, errorMsg) => {
    if (profile) {
      showAppView(profile);
      if (profile.role === 'admin') await seedIfEmpty();
    } else {
      showLoginView();
      if (errorMsg) {
        const errorEl = document.getElementById('login-error');
        errorEl.textContent = errorMsg;
        errorEl.hidden = false;
      }
    }
  });
}

// app.js es un módulo (carga diferida): el DOM ya está listo cuando esto se ejecuta,
// así que no hace falta (ni conviene) esperar 'DOMContentLoaded' aquí.
init();
