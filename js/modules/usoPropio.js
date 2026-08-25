// Salida de productos para consumo propio del negocio.
//
// Vive aparte porque se usa desde dos lados: Inventario (para el administrador) y
// Ventas (para el mostrador, que es donde de verdad ocurre: alguien agarra un
// filtro y hay que dejar constancia en el momento, sin cobrarlo).
import { addRecord } from '../data.js';
import { openModal, closeModal, toast, productSearch } from '../ui.js';
import { escapeHtml, formatQ, round2, todayISO } from '../utils.js';
import { applyStockChange } from './inventoryCore.js';
import { getCurrentUser } from '../auth.js';

/**
 * Abre el formulario de salida por uso propio.
 *
 * Descuenta stock y deja constancia en el historial, pero NO toca la caja: no
 * entra ni sale dinero, así que no afecta el cuadre diario ni genera comisión.
 *
 * @param {Array}    products   catálogo completo de productos
 * @param {Array}    empleados  personas a las que se puede atribuir la salida
 * @param {Function} onSaved    se llama al guardar, para refrescar la pantalla
 */
export function openUsoPropioForm({ products, empleados = [], onSaved }) {
  const activos = products.filter((p) => p.estado !== 'inactivo' && Number(p.stock) > 0);
  const user = getCurrentUser();
  const carrito = [];
  const buscador = productSearch(activos, { id: 'up-producto', label: 'Buscar producto', clearOnSelect: true });

  // El responsable se ELIGE, no se hereda de la cuenta con la que se entró. Antes
  // se rellenaba solo con el nombre de la cuenta, así que todo terminaba quedando
  // a nombre del administrador aunque el producto lo hubiera sacado otra persona.
  const opcionesEmpleado = empleados.length
    ? `<select id="up-responsable">
         <option value="">— Elige quién lo sacó —</option>
         ${empleados.map((e) => `<option value="${escapeHtml(e.nombre)}">${escapeHtml(e.nombre)}</option>`).join('')}
       </select>`
    : `<input id="up-responsable" placeholder="¿Quién lo sacó?" autocomplete="off">`;

  openModal('Salida por uso propio', `
    <div class="card" style="background:var(--primary-light);border-color:var(--primary);margin-bottom:14px">
      Estos productos <b>salen del inventario pero no mueven dinero</b>: no entran a la caja,
      no afectan el cuadre diario y no generan comisión. Quedan registrados a nombre de quien los saca.
    </div>
    <div class="form-row">
      <label>¿Quién lo sacó? ${opcionesEmpleado}</label>
      <label>Fecha <input type="date" id="up-fecha" value="${todayISO()}" max="${todayISO()}"></label>
    </div>
    <label>¿Para qué? (opcional)
      <input id="up-nota" autocomplete="off" placeholder="ej. Uso en el otro negocio">
    </label>

    <div class="section-title">Productos que salen</div>
    ${buscador.html}
    <button type="button" class="btn btn-secondary btn-block mt-16" id="up-libre-toggle">
      + Sacar algo que no está en la lista (filtro, etc.)
    </button>
    <div class="libre-box" id="up-libre" hidden>
      <label>¿Qué sacaste?
        <input id="up-libre-desc" autocomplete="off" placeholder="ej. Filtro de aire Autox L200">
      </label>
      <p class="text-muted" style="font-size:12.5px;margin:6px 0 10px">
        Como no está en el catálogo, no descuenta stock: queda solo como constancia de que salió.
      </p>
      <button type="button" class="btn btn-primary btn-block" id="up-libre-add">Agregar a la salida</button>
    </div>
    <div id="up-lista" class="text-muted mt-16">Sin productos. Búscalos arriba y tócalos para agregarlos.</div>

    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
      <button type="button" class="btn btn-primary" id="up-save">Registrar salida</button>
    </div>
  `);

  const $ = (id) => document.getElementById(id);
  $('cancel-form').addEventListener('click', closeModal);

  buscador.mount({
    onSelect: (p) => {
      const existente = carrito.find((i) => i.productoId === p.id);
      if (existente) {
        if (existente.cantidad + 1 > Number(p.stock)) { toast(`Solo hay ${p.stock} de ${p.nombre}.`, 'danger'); return; }
        existente.cantidad += 1;
      } else {
        carrito.push({ productoId: p.id, nombre: p.nombre, stock: Number(p.stock), cantidad: 1, precioCompra: Number(p.precioCompra || 0) });
      }
      renderLista();
    },
  });

  // Artículo que no está en el catálogo: se anota igual para dejar constancia,
  // aunque no haya stock que descontar.
  const panelLibre = $('up-libre');
  $('up-libre-toggle').addEventListener('click', () => {
    panelLibre.hidden = !panelLibre.hidden;
    if (!panelLibre.hidden) $('up-libre-desc').focus();
  });
  function agregarLibre() {
    const desc = $('up-libre-desc').value.trim();
    if (!desc) { toast('Escribe qué sacaste.', 'danger'); $('up-libre-desc').focus(); return; }
    carrito.push({ productoId: null, libre: true, nombre: desc, cantidad: 1, precioCompra: 0 });
    $('up-libre-desc').value = '';
    $('up-libre-desc').focus();
    renderLista();
  }
  $('up-libre-add').addEventListener('click', agregarLibre);
  $('up-libre-desc').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); agregarLibre(); }
  });

  function renderLista() {
    const list = $('up-lista');
    if (!carrito.length) {
      list.innerHTML = '<span class="text-muted">Sin productos. Búscalos arriba y tócalos para agregarlos.</span>';
      return;
    }
    const costo = round2(carrito.reduce((s, i) => s + i.cantidad * i.precioCompra, 0));
    list.innerHTML = carrito.map((i, idx) => `
      <div class="cart-line">
        <span class="cart-name">${escapeHtml(i.nombre)}${i.libre ? ' <span class="badge badge-info">no descuenta stock</span>' : ''}</span>
        <span class="cart-qty">
          <button type="button" class="btn btn-secondary btn-sm" data-dec="${idx}">−</button>
          <input type="number" min="1" step="1" value="${i.cantidad}" data-qty="${idx}">
          <button type="button" class="btn btn-secondary btn-sm" data-inc="${idx}">+</button>
        </span>
        <span class="text-muted" style="font-size:12.5px">${i.libre ? '' : 'de ' + i.stock}</span>
        <button type="button" class="btn btn-danger btn-sm" data-rm="${idx}">✕</button>
      </div>`).join('')
      + `<p class="text-right mt-16 text-muted">Costo de lo que sale: <b>${formatQ(costo)}</b></p>`;

    const setQty = (idx, valor) => {
      const item = carrito[idx];
      const n = Math.max(1, Math.floor(Number(valor) || 1));
      if (!item.libre && n > item.stock) { toast(`Solo hay ${item.stock} de ${item.nombre}.`, 'danger'); item.cantidad = item.stock; }
      else item.cantidad = n;
      renderLista();
    };
    list.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { carrito.splice(Number(b.dataset.rm), 1); renderLista(); }));
    list.querySelectorAll('[data-inc]').forEach((b) => b.addEventListener('click', () => setQty(Number(b.dataset.inc), carrito[Number(b.dataset.inc)].cantidad + 1)));
    list.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => {
      const idx = Number(b.dataset.dec);
      if (carrito[idx].cantidad <= 1) { carrito.splice(idx, 1); renderLista(); } else setQty(idx, carrito[idx].cantidad - 1);
    }));
    list.querySelectorAll('[data-qty]').forEach((el) => el.addEventListener('change', () => setQty(Number(el.dataset.qty), el.value)));
  }

  $('up-save').addEventListener('click', async () => {
    if (!carrito.length) { toast('Agrega al menos un producto.', 'danger'); return; }
    const responsable = $('up-responsable').value.trim();
    if (!responsable) { toast('Elige quién saca los productos.', 'danger'); $('up-responsable').focus(); return; }
    const btn = $('up-save');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const nota = $('up-nota').value.trim();
      const fecha = $('up-fecha').value || todayISO();
      // Todas las líneas salen JUNTAS. Cada una toca un producto distinto, así que
      // sus transacciones no se pisan; en fila, sacar diez productos esperaba diez
      // viajes al servidor uno tras otro.
      //
      // Aquí no se usa `applyStockChanges` porque cada línea lleva SU propio costo
      // unitario, y ese helper reparte las mismas opciones a todas.
      await Promise.all(carrito.map((item) => {
        // El costo queda guardado en el movimiento para que el reporte pueda
        // decir cuánto producto salió sin generar ingreso, sin tener que ir a
        // buscar el precio de compra de cada producto después (que además pudo
        // haber cambiado desde entonces).
        const costoUnitario = Number(item.precioCompra) || 0;
        if (item.productoId) {
          return applyStockChange(item.productoId, -item.cantidad, {
            motivo: 'uso propio',
            referenciaId: null,
            usuario: { uid: user?.uid, nombre: responsable },
            extra: { nota, fecha, costoUnitario },
          });
        }
        // No está en el catálogo: no hay stock que mover, solo queda la constancia.
        return addRecord('inventoryMovements', {
          productoId: null, libre: true, productoNombre: item.nombre,
          tipo: 'salida', motivo: 'uso propio', cantidad: item.cantidad,
          stockResultante: null, referenciaId: null,
          usuarioId: user?.uid || null, usuarioNombre: responsable,
          nota, fecha, costoUnitario: 0,
        });
      }));
      toast('Salida registrada. No afecta la caja.', 'success', 4500);
      closeModal();
      if (onSaved) onSaved();
    } catch (err) {
      toast('No se pudo registrar la salida: ' + err.message, 'danger');
      btn.disabled = false;
      btn.textContent = 'Registrar salida';
    }
  });

  renderLista();
}
