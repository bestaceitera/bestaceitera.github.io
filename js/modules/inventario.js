import { getAll } from '../data.js';
import { renderTable } from '../ui.js';
import { formatQ, formatDateTime } from '../utils.js';

async function render(container) {
  const [products, movements] = await Promise.all([
    getAll('products', { order: 'nombre' }),
    getAll('inventoryMovements', { order: 'createdAt', direction: 'desc' }),
  ]);

  const lowStock = products.filter((p) => Number(p.stock) <= Number(p.stockMinimo ?? 0));

  const table = renderTable({
    columns: [
      { key: 'createdAt', label: 'Fecha', format: (r) => formatDateTime(r.createdAt) },
      { key: 'productoNombre', label: 'Producto' },
      { key: 'tipo', label: 'Tipo', format: (r) => r.tipo === 'entrada'
          ? `<span class="badge badge-success">Entrada</span>` : `<span class="badge badge-danger">Salida</span>` },
      { key: 'motivo', label: 'Motivo' },
      { key: 'cantidad', label: 'Cantidad' },
      { key: 'stockResultante', label: 'Stock resultante' },
      { key: 'usuarioNombre', label: 'Usuario' },
    ],
    rows: movements,
    searchKeys: ['productoNombre', 'motivo', 'usuarioNombre'],
    emptyMessage: 'Aún no hay movimientos de inventario.',
    pageSize: 15,
  });

  container.innerHTML = `
    <div class="grid grid-4" style="margin-bottom:16px">
      <div class="stat-card"><div class="label">Productos activos</div><div class="value">${products.filter((p) => p.estado !== 'inactivo').length}</div></div>
      <div class="stat-card"><div class="label">Stock bajo mínimo</div><div class="value" style="color:var(--danger)">${lowStock.length}</div></div>
      <div class="stat-card"><div class="label">Valor inventario (costo)</div><div class="value">${formatQ(products.reduce((s, p) => s + Number(p.stock || 0) * Number(p.precioCompra || 0), 0))}</div></div>
      <div class="stat-card"><div class="label">Movimientos registrados</div><div class="value">${movements.length}</div></div>
    </div>
    ${lowStock.length ? `<div class="card" style="border-color:var(--danger);background:var(--danger-light);margin-bottom:16px">
        <b>⚠ Alerta de stock bajo:</b> ${lowStock.map((p) => `${p.nombre} (${p.stock})`).join(', ')}
      </div>` : ''}
    <div class="section-title">Kardex / historial de movimientos</div>
    <div class="card" id="inv-kardex-card">${table.html}</div>
  `;
  table.mount(container.querySelector('#inv-kardex-card'));
}

export default { render };
