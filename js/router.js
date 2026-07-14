import { setPageTitle, toast } from './ui.js';

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

async function renderRoute() {
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
  container.innerHTML = '<div class="empty-state">Cargando…</div>';
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
  window.addEventListener('hashchange', renderRoute);
  renderRoute();
}

export function navigate(hash) {
  location.hash = `#${hash}`;
}
