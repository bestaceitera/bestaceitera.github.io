// Panel de productos con stock bajo, compartido por Dashboard, Inventario y Productos.
//
// Antes era una lista de nombres separados por comas: con nueve productos ya
// costaba leerla, y sobre todo no distinguía lo urgente (algo que se ACABÓ) de lo
// que solo va bajo. Ahora cada producto es una tarjeta con su stock y su mínimo,
// y lo agotado va primero y en rojo.
import { escapeHtml } from '../utils.js';

/** Productos en o por debajo de su mínimo, los agotados primero. */
export function productosBajoMinimo(products) {
  return products
    .filter((p) => p.estado !== 'inactivo' && Number(p.stock) <= Number(p.stockMinimo ?? 0))
    .map((p) => ({
      nombre: p.nombre,
      stock: Number(p.stock) || 0,
      minimo: Number(p.stockMinimo ?? 0),
      agotado: Number(p.stock) <= 0,
    }))
    // Primero lo agotado; entre lo demás, lo que está más lejos de su mínimo.
    .sort((a, b) => (a.agotado !== b.agotado ? (a.agotado ? -1 : 1) : (a.stock - a.minimo) - (b.stock - b.minimo)));
}

/**
 * Devuelve el HTML del panel. `max` limita cuántas tarjetas se dibujan para que
 * en el Dashboard no ocupe media pantalla; el resto se resume en una línea.
 */
export function stockBajoHtml(products, { max = 12, titulo = 'Hay que pedir' } = {}) {
  const bajos = productosBajoMinimo(products);
  if (!bajos.length) return '';

  const agotados = bajos.filter((p) => p.agotado).length;
  const visibles = bajos.slice(0, max);
  const restantes = bajos.length - visibles.length;

  return `
    <div class="stock-bajo">
      <div class="stock-bajo-head">
        <span class="stock-bajo-titulo">⚠ ${escapeHtml(titulo)}</span>
        <span class="stock-bajo-conteo">
          ${bajos.length} producto${bajos.length === 1 ? '' : 's'}${agotados ? ` · <b>${agotados} agotado${agotados === 1 ? '' : 's'}</b>` : ''}
        </span>
      </div>
      <div class="stock-bajo-grid">
        ${visibles.map((p) => `
          <div class="stock-item${p.agotado ? ' agotado' : ''}">
            <span class="stock-item-nombre" title="${escapeHtml(p.nombre)}">${escapeHtml(p.nombre)}</span>
            <span class="stock-item-cifra">
              ${p.agotado ? 'Agotado' : `Quedan <b>${p.stock}</b>`}
              <span class="stock-item-min">mín. ${p.minimo}</span>
            </span>
          </div>`).join('')}
      </div>
      ${restantes > 0 ? `<div class="stock-bajo-resto">y ${restantes} producto${restantes === 1 ? '' : 's'} más — míralos en Inventario</div>` : ''}
    </div>`;
}
