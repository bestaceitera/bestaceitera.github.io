import { escapeHtml, formatQ } from './utils.js';

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

/* ---------------- Buscador de productos (combobox) ---------------- */
/**
 * productSearch(products, { id, label }) — campo de texto con lista de
 * coincidencias para elegir un producto escribiendo su nombre.
 * Devuelve { html, mount }. mount({ onSelect }) engancha los eventos y
 * devuelve { getSelected, clear }.
 */
export function productSearch(products, { id = 'prod-search', label = 'Producto (escribe para buscar)', clearOnSelect = false } = {}) {
  const html = `
    <label class="prod-search">${escapeHtml(label)}
      <input type="text" id="${id}" placeholder="Escribe y toca el producto para agregarlo…" autocomplete="off">
      <div class="prod-search-results" id="${id}-results" hidden></div>
    </label>`;

  function mount({ onSelect } = {}) {
    const input = document.getElementById(id);
    const results = document.getElementById(`${id}-results`);
    let selected = null;

    // Se busca por nombre, marca, categoría, viscosidad y presentación, así no hace
    // falta repetir la marca dentro del nombre del producto para poder encontrarlo.
    const haystack = (p) => `${p.nombre} ${p.marca || ''} ${p.categoria || ''} ${p.viscosidad || ''} ${p.presentacion || ''}`.toLowerCase();

    function show() {
      const t = input.value.trim().toLowerCase();
      const matches = (t ? products.filter((p) => haystack(p).includes(t)) : products).slice(0, 25);
      results.innerHTML = matches.length
        ? matches.map((p) => {
            const detalle = [p.marca, p.presentacion, p.viscosidad].filter(Boolean).join(' · ');
            const sinStock = Number(p.stock) <= 0;
            return `
            <div class="prod-search-item${sinStock ? ' is-out' : ''}" data-id="${p.id}">
              <span>${escapeHtml(p.nombre)}${detalle ? ` <small class="text-muted">${escapeHtml(detalle)}</small>` : ''}</span>
              <span class="text-muted">${sinStock ? 'sin stock' : `stock: ${p.stock}`} · ${formatQ(p.precioVenta)}</span>
            </div>`;
          }).join('')
        : `<div class="prod-search-item is-empty text-muted">No se encontró ningún producto con ese nombre.</div>`;
      results.hidden = false;
    }

    input.addEventListener('input', () => { selected = null; show(); });
    input.addEventListener('focus', show);
    // mousedown (no click) para que se dispare antes del blur del input
    results.addEventListener('mousedown', (e) => {
      const item = e.target.closest('[data-id]');
      if (!item) return;
      e.preventDefault();
      selected = products.find((p) => p.id === item.dataset.id) || null;
      if (!selected) return;
      if (clearOnSelect) {
        // Modo "agregar de un toque": deja el campo listo para el siguiente producto.
        input.value = '';
        results.hidden = true;
        onSelect?.(selected);
        selected = null;
        input.focus();
      } else {
        input.value = selected.nombre;
        results.hidden = true;
        onSelect?.(selected);
      }
    });
    input.addEventListener('blur', () => { setTimeout(() => { results.hidden = true; }, 150); });

    return {
      getSelected: () => selected,
      clear: () => { selected = null; input.value = ''; results.hidden = true; },
      focus: () => input.focus(),
    };
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
