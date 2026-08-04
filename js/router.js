import { setPageTitle, toast, modalAbierto } from './ui.js';
import { listen } from './data.js';

const routes = new Map();
const sections = [];
let currentProfile = null;

/**
 * registerRoute({ hash, label, icon, section, roles, render })
 * render(container, profile) puede ser async.
 */
export function registerRoute({ hash, label, icon = '•', section = 'General', roles = ['admin', 'empleado'], render }) {
  routes.set(hash, { hash, label, icon, section, roles, render });
  if (!sections.includes(section)) sections.push(section);
}

function buildSidebar(profile) {
  const nav = document.getElementById('sidebar-nav');
  let html = '';
  for (const section of sections) {
    const items = [...routes.values()].filter((r) => r.section === section && r.roles.includes(profile.role));
    if (!items.length) continue;
    html += `<div class="nav-section">${section}</div>`;
    for (const item of items) {
      html += `<a href="#${item.hash}" data-hash="${item.hash}">${item.icon} <span>${item.label}</span></a>`;
    }
  }
  nav.innerHTML = html;
}

function highlightActive(hash) {
  document.querySelectorAll('#sidebar-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.hash === hash);
  });
}

/* ---------------- Sincronización en vivo entre dispositivos ----------------
 * Cada pantalla se queda escuchando las colecciones que le interesan, así que
 * si el empleado registra una venta en el mostrador, la pantalla del admin se
 * actualiza sola, sin tener que recargar ni volver a entrar a la sección.
 */
const COLECCIONES_POR_RUTA = {
  dashboard: ['sales', 'serviceOrders', 'cashMovements', 'deposits', 'products'],
  ventas: ['sales'],
  'ordenes-servicio': ['serviceOrders'],
  clientes: ['customers'],
  caja: ['cashMovements', 'cashClosings', 'cashReturns'],
  depositos: ['deposits'],
  inventario: ['inventoryMovements', 'products'],
  productos: ['products'],
};

let unsubs = [];
let rutaActual = null;
let refrescoPendiente = false;
let temporizador = null;

function detenerEscuchas() {
  unsubs.forEach((u) => { try { u(); } catch { /* ya estaba cerrada */ } });
  unsubs = [];
}

function programarRefresco() {
  clearTimeout(temporizador);
  // Pequeña espera para agrupar varios cambios seguidos en un solo refresco.
  temporizador = setTimeout(() => renderRoute({ silencioso: true }), 500);
}

// Para detectar que ALGUIEN agregó algo basta con vigilar el registro más nuevo:
// así cada pantalla escucha con 1 solo documento en vez de la colección entera.
const SOLO_EL_MAS_NUEVO = new Set(['sales', 'serviceOrders', 'cashMovements', 'deposits', 'inventoryMovements', 'customers', 'cashClosings', 'cashReturns']);

function escucharCambios(hash) {
  detenerEscuchas();
  const cols = COLECCIONES_POR_RUTA[hash];
  if (!cols) return;
  for (const nombre of cols) {
    let esPrimera = true;
    const opciones = SOLO_EL_MAS_NUEVO.has(nombre)
      ? { order: 'createdAt', direction: 'desc', max: 1 }
      : {}; // products cambia por edición, no solo por altas: hay que mirarlo completo
    unsubs.push(listen(nombre, () => {
      // La primera respuesta trae el estado actual, no es un cambio nuevo.
      if (esPrimera) { esPrimera = false; return; }
      if (hash !== rutaActual) return;
      // Nunca refrescar encima de un formulario abierto: se perdería lo escrito.
      if (modalAbierto()) { refrescoPendiente = true; return; }
      programarRefresco();
    }, opciones));
  }
}

document.addEventListener('modal:closed', () => {
  if (refrescoPendiente) { refrescoPendiente = false; programarRefresco(); }
});

async function renderRoute({ silencioso = false } = {}) {
  const hash = (location.hash || '#dashboard').slice(1);
  const route = routes.get(hash) || routes.get('dashboard');
  if (!route.roles.includes(currentProfile.role)) {
    toast('No tienes permiso para ver esa sección.', 'danger');
    location.hash = '#dashboard';
    return;
  }
  setPageTitle(route.label);
  highlightActive(route.hash);
  const container = document.getElementById('main-content');
  // En un refresco automático no se muestra "Cargando…" para que no parpadee.
  if (!silencioso) container.innerHTML = '<div class="empty-state">Cargando…</div>';
  if (rutaActual !== route.hash) {
    rutaActual = route.hash;
    escucharCambios(route.hash);
  }
  try {
    await route.render(container, currentProfile);
  } catch (err) {
    console.error(err);
    container.innerHTML = `<div class="empty-state">Ocurrió un error cargando esta sección.<br><span class="text-muted">${err.message || ''}</span></div>`;
  }
  document.getElementById('sidebar').classList.remove('open');
}

export function initRouter(profile) {
  currentProfile = profile;
  buildSidebar(profile);
  window.addEventListener('hashchange', () => renderRoute());
  renderRoute();
}

export function navigate(hash) {
  location.hash = `#${hash}`;
}
