import { escapeHtml, formatQ, todayISO } from './utils.js';

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
  // Avisa al router para que aplique los cambios que llegaron de otro dispositivo
  // mientras había un formulario abierto (no se refresca encima del formulario).
  document.dispatchEvent(new CustomEvent('modal:closed'));
}

export function modalAbierto() {
  return !document.getElementById('modal-backdrop').hidden;
}

// ui.js se importa desde app.js, un módulo cargado de forma diferida, así que el
// DOM ya existe cuando este archivo se evalúa (no hace falta esperar un evento).
document.getElementById('modal-close')?.addEventListener('click', closeModal);
document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});
// Escape cierra el formulario abierto: es lo que cualquiera espera al equivocarse
// de botón, y evita quedarse atrapado en una pantalla en un celular.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalAbierto()) closeModal();
});

export function confirmDialog(message) {
  return new Promise((resolve) => {
    openModal('Confirmar', `
      <p style="white-space:pre-line">${escapeHtml(message)}</p>
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
/**
 * `rowClass(fila)` permite marcar filas especiales — por ejemplo los totales al
 * pie de un reporte, que si se ven igual que los demás se leen como un día más.
 */
export function renderTable({ columns, rows, searchKeys = [], pageSize = 10, emptyMessage = 'Sin registros', extraToolbar = '', rowClass = null }) {
  const state = { page: 1, query: '' };

  function filteredRows() {
    if (!state.query) return rows;
    const q = state.query.toLowerCase();
    return rows.filter((r) => searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q)));
  }

  function renderBody(container) {
    // Si mientras se esperaba la respuesta el usuario cambió de pantalla, este
    // contenedor ya no está en el documento: pintar aquí reventaría (y de todos
    // modos nadie lo vería). Se abandona en silencio.
    if (!container.isConnected) return;
    const data = filteredRows();
    const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
    if (state.page > totalPages) state.page = totalPages;
    const start = (state.page - 1) * pageSize;
    const pageRows = data.slice(start, start + pageSize);

    const thead = `<thead><tr>${columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr></thead>`;
    // Cuando la búsqueda no encuentra nada NO se puede decir "aún no hay
    // registros": los hay, solo que ninguno coincide. Decir lo contrario hace
    // creer que se perdieron los datos.
    const vacio = state.query.trim()
      ? `No se encontró nada con “${escapeHtml(state.query.trim())}”. Revisa cómo está escrito o borra la búsqueda para ver todo.`
      : escapeHtml(emptyMessage);
    const tbody = pageRows.length
      ? `<tbody>${pageRows.map((r) => {
          const cls = rowClass ? rowClass(r) : '';
          return `<tr${cls ? ` class="${escapeHtml(cls)}"` : ''}>${columns.map((c) => `<td>${c.format ? c.format(r) : escapeHtml(r[c.key] ?? '')}</td>`).join('')}</tr>`;
        }).join('')}</tbody>`
      : `<tbody><tr><td colspan="${columns.length}" class="table-empty">${vacio}</td></tr></tbody>`;

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

/* ---------------- Filtro de fechas (compartido por Ventas y Reportes) ---------------- */
/** Fecha local en formato YYYY-MM-DD, sin que la zona horaria corra el día. */
function isoLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function applyRangePreset(range) {
  const now = new Date();
  if (range === 'hoy') return { from: todayISO(), to: todayISO() };
  if (range === 'ayer') {
    const ayer = new Date(now); ayer.setDate(now.getDate() - 1);
    return { from: isoLocal(ayer), to: isoLocal(ayer) };
  }
  if (range === 'semana') {
    const day = now.getDay() || 7;
    const lunes = new Date(now); lunes.setDate(now.getDate() - day + 1);
    return { from: isoLocal(lunes), to: todayISO() };
  }
  if (range === 'quincena') {
    // Quincena guatemalteca: del 1 al 15, o del 16 al fin de mes.
    const inicio = now.getDate() <= 15 ? 1 : 16;
    return { from: isoLocal(new Date(now.getFullYear(), now.getMonth(), inicio)), to: todayISO() };
  }
  if (range === 'mes') return { from: isoLocal(new Date(now.getFullYear(), now.getMonth(), 1)), to: todayISO() };
  if (range === 'anio') return { from: isoLocal(new Date(now.getFullYear(), 0, 1)), to: todayISO() };
  return { from: '2000-01-01', to: '2100-01-01' };
}

export function dateRangePresetButtons({ conAyer = false } = {}) {
  return `
    <button class="btn btn-secondary btn-sm" data-range="hoy">Hoy</button>
    ${conAyer ? `<button class="btn btn-secondary btn-sm" data-range="ayer">Ayer</button>` : ''}
    <button class="btn btn-secondary btn-sm" data-range="semana">Esta semana</button>
    <button class="btn btn-secondary btn-sm" data-range="quincena">Esta quincena</button>
    <button class="btn btn-secondary btn-sm" data-range="mes">Este mes</button>
    <button class="btn btn-secondary btn-sm" data-range="anio">Este año</button>
    <button class="btn btn-secondary btn-sm" data-range="todo">Todo</button>
    <input type="date" data-from style="width:auto;padding:5px 8px;font-size:12.5px">
    <input type="date" data-to style="width:auto;padding:5px 8px;font-size:12.5px">
    <button class="btn btn-secondary btn-sm" data-apply>Aplicar fechas</button>
  `;
}

export function bindRangeControls(el, setRange, { activo = null } = {}) {
  // El botón del período elegido queda resaltado: de un vistazo se sabe qué se
  // está viendo, sin tener que leer las fechas.
  const marcar = (valor) => el.querySelectorAll('[data-range]').forEach((b) => {
    const encendido = b.dataset.range === valor;
    b.classList.toggle('btn-primary', encendido);
    b.classList.toggle('btn-secondary', !encendido);
  });
  if (activo) marcar(activo);
  // setRange recibe también el nombre del preset para que la pantalla pueda
  // recordar cuál estaba elegido y no perderlo al refrescarse sola.
  el.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
    marcar(b.dataset.range);
    setRange(applyRangePreset(b.dataset.range), b.dataset.range);
  }));
  el.querySelector('[data-apply]')?.addEventListener('click', () => {
    const from = el.querySelector('[data-from]').value;
    const to = el.querySelector('[data-to]').value;
    if (!from || !to) { toast('Elige las dos fechas.', 'info'); return; }
    if (from > to) { toast('La fecha inicial no puede ser mayor que la final.', 'danger'); return; }
    marcar(null); // fechas a mano: ningún preset está activo
    setRange({ from, to }, null);
  });
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
