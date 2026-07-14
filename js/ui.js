import { escapeHtml } from './utils.js';

/* ---------------- Toast ---------------- */
export function toast(message, type = 'info', ms = 3500) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ---------------- Modal ---------------- */
let modalCloseCallback = null;

export function openModal(title, bodyHtml, { onClose } = {}) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = bodyHtml;
  document.getElementById('modal-backdrop').hidden = false;
  modalCloseCallback = onClose || null;
}

export function closeModal() {
  document.getElementById('modal-backdrop').hidden = true;
  document.getElementById('modal-body').innerHTML = '';
  if (modalCloseCallback) modalCloseCallback();
  modalCloseCallback = null;
}

// ui.js se importa desde app.js, un módulo cargado de forma diferida, así que el
// DOM ya existe cuando este archivo se evalúa (no hace falta esperar un evento).
document.getElementById('modal-close')?.addEventListener('click', closeModal);
document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});

export function confirmDialog(message) {
  return new Promise((resolve) => {
    openModal('Confirmar', `
      <p>${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="confirm-no">Cancelar</button>
        <button class="btn btn-danger" id="confirm-yes">Sí, continuar</button>
      </div>
    `);
    document.getElementById('confirm-yes').onclick = () => { closeModal(); resolve(true); };
    document.getElementById('confirm-no').onclick = () => { closeModal(); resolve(false); };
  });
}

/* ---------------- Tabla con búsqueda + paginación ---------------- */
/**
 * renderTable({ columns, rows, searchKeys, pageSize, emptyMessage, rowActions })
 * columns: [{key, label, format?}]
 * rows: array de objetos
 * Devuelve { html, mount } — mount(container) engancha búsqueda/paginación.
 */
export function renderTable({ columns, rows, searchKeys = [], pageSize = 10, emptyMessage = 'Sin registros', extraToolbar = '' }) {
  const state = { page: 1, query: '' };

  function filteredRows() {
    if (!state.query) return rows;
    const q = state.query.toLowerCase();
    return rows.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
  }

  function renderBody(container) {
    const data = filteredRows();
    const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * pageSize;
    const pageRows = data.slice(start, start + pageSize);

    const thead = `<thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`;
    const tbody = pageRows.length
      ? `<tbody>${pageRows.map((r) => `<tr>${columns.map((c) => `<td>${c.format ? c.format(r) : escapeHtml(r[c.key] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>`
      : `<tbody><tr><td colspan="${columns.length}" class="table-empty">${escapeHtml(emptyMessage)}</td></tr></tbody>`;

    const wrap = container.querySelector('.table-wrap');
    wrap.innerHTML = `<table>${thead}${tbody}</table>`;

    const pag = container.querySelector('.pagination');
    pag.innerHTML = data.length
      ? `<span class="text-muted">${data.length} registro(s)</span>
         <button class="btn btn-secondary btn-sm" data-act="prev" ${state.page <= 1 ? 'disabled' : ''}>‹</button>
         <span class="text-muted">Página ${state.page} / ${totalPages}</span>
         <button class="btn btn-secondary btn-sm" data-act="next" ${state.page >= totalPages ? 'disabled' : ''}>›</button>`
      : '';

    pag.querySelector('[data-act="prev"]')?.addEventListener('click', () => { state.page--; renderBody(container); });
    pag.querySelector('[data-act="next"]')?.addEventListener('click', () => { state.page++; renderBody(container); });

    // vuelve a enganchar acciones por fila (data-row-action) si el caller las agregó vía c.format con data attrs
    container.dispatchEvent(new CustomEvent('table:rendered', { detail: { pageRows } }));
  }

  const html = `
    <div class="toolbar">
      ${searchKeys.length ? `<input type="search" class="search-box" placeholder="Buscar..." data-role="table-search">` : ''}
      <div class="spacer"></div>
      ${extraToolbar}
    </div>
    <div class="table-wrap"></div>
    <div class="pagination"></div>
  `;

  function mount(container) {
    const search = container.querySelector('[data-role="table-search"]');
    search?.addEventListener('input', (e) => { state.query = e.target.value; state.page = 1; renderBody(container); });
    renderBody(container);
    return { refresh: (newRows) => { rows = newRows; renderBody(container); } };
  }

  return { html, mount };
}

/* ---------------- Confirm de formulario simple ---------------- */
export function formValues(form) {
  const data = {};
  new FormData(form).forEach((v, k) => { data[k] = v; });
  return data;
}

export function setPageTitle(title) {
  document.getElementById('page-title').textContent = title;
  document.title = `${title} — BEST Aceitera y Mecánica Rápida`;
}
