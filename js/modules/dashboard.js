import { getAll, countRecords } from '../data.js';
import { formatQ, todayISO, round2 } from '../utils.js';
import { barChart, lineChart } from '../charts.js';
import { escapeHtml } from '../utils.js';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

function lastMonths(n) {
  const now = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MESES[d.getMonth()] });
  }
  return out;
}

async function render(container, profile) {
  container.innerHTML = '<div class="empty-state">Cargando…</div>';
  const isAdmin = profile.role === 'admin';

  // El dashboard solo necesita los últimos 6 meses (es lo que grafica) y la caja de
  // hoy. Pedir el historial completo lo volvería lentísimo con los años.
  const desde = new Date();
  desde.setMonth(desde.getMonth() - 5);
  const desdeISO = `${desde.getFullYear()}-${String(desde.getMonth() + 1).padStart(2, '0')}-01`;

  const [sales, serviceOrders, products, cashMovementsToday, deposits] = await Promise.all([
    getAll('sales', { filters: [['fecha', '>=', desdeISO]], max: 4000 }),
    getAll('serviceOrders', { filters: [['fecha', '>=', desdeISO]], max: 2000 }),
    getAll('products'),
    getAll('cashMovements', { filters: [['fecha', '==', todayISO()]] }),
    getAll('deposits', { order: 'createdAt', direction: 'desc', max: 5 }),
  ]);
  // Estos tres solo se muestran como cantidad: se cuentan en el servidor en vez
  // de descargarlos, así el dashboard no se frena aunque haya miles de registros.
  const [numCompras, numClientes, numProveedores] = isAdmin
    ? await Promise.all([countRecords('purchases'), countRecords('customers'), countRecords('suppliers')])
    : [0, 0, 0];

  const today = todayISO();
  const ventasHoy = sales.filter((s) => s.fecha === today);
  const serviciosHoy = serviceOrders.filter((s) => s.fecha === today);
  const totalVentasHoy = round2(ventasHoy.reduce((s, v) => s + v.total, 0));
  const totalServiciosHoy = round2(serviciosHoy.reduce((s, v) => s + v.total, 0));
  const lowStock = products.filter((p) => Number(p.stock) <= Number(p.stockMinimo ?? 0));

  const movementsToday = cashMovementsToday.filter((m) => m.fecha === today);
  const fondoInicial = movementsToday.filter((m) => m.categoria === 'fondo_inicial').reduce((s, m) => s + m.monto, 0);
  const entradas = movementsToday.filter((m) => m.tipo === 'entrada' && m.categoria !== 'fondo_inicial').reduce((s, m) => s + m.monto, 0);
  const salidas = movementsToday.filter((m) => m.tipo === 'salida').reduce((s, m) => s + m.monto, 0);
  const efectivoEsperado = round2(fondoInicial + entradas - salidas);

  const ultimosDepositos = deposits.slice(0, 5);

  // Gráfica ventas mensuales (últimos 6 meses)
  const months = lastMonths(6);
  const ventasPorMes = months.map((m) => ({
    label: m.label,
    value: round2(sales.filter((s) => (s.fecha || '').slice(0, 7) === m.key).reduce((s, v) => s + v.total, 0)),
  }));

  // Productos más vendidos (top 5)
  const soldQty = {};
  sales.forEach((s) => s.items?.forEach((i) => { soldQty[i.nombre] = (soldQty[i.nombre] || 0) + i.cantidad; }));
  const topProductos = Object.entries(soldQty).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));

  // Servicios más realizados (top 5)
  const servCount = {};
  serviceOrders.forEach((o) => o.servicios?.forEach((s) => { servCount[s.nombre] = (servCount[s.nombre] || 0) + 1; }));
  const topServicios = Object.entries(servCount).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value }));

  container.innerHTML = `
    <div class="grid grid-4">
      <div class="stat-card"><div class="label">Ventas de hoy</div><div class="value">${formatQ(totalVentasHoy)}</div><div class="sub">${ventasHoy.length} venta(s)</div></div>
      <div class="stat-card"><div class="label">Servicios de hoy</div><div class="value">${formatQ(totalServiciosHoy)}</div><div class="sub">${serviciosHoy.length} orden(es)</div></div>
      <div class="stat-card"><div class="label">Efectivo esperado en caja</div><div class="value">${formatQ(efectivoEsperado)}</div></div>
      <div class="stat-card"><div class="label">Productos con stock bajo</div><div class="value" style="color:${lowStock.length ? 'var(--danger)' : 'inherit'}">${lowStock.length}</div></div>
      ${isAdmin ? `
      <div class="stat-card"><div class="label">Compras registradas</div><div class="value">${numCompras}</div></div>
      <div class="stat-card"><div class="label">Clientes registrados</div><div class="value">${numClientes}</div></div>
      <div class="stat-card"><div class="label">Proveedores</div><div class="value">${numProveedores}</div></div>
      <div class="stat-card"><div class="label">Productos activos</div><div class="value">${products.filter((p) => p.estado !== 'inactivo').length}</div></div>
      ` : ''}
    </div>

    ${lowStock.length ? `<div class="card mt-16" style="border-color:var(--danger);background:var(--danger-light)">
        ⚠ <b>Alerta de stock bajo:</b> ${lowStock.map((p) => escapeHtml(p.nombre)).join(', ')}
      </div>` : ''}

    <div class="grid grid-2 mt-16">
      <div class="card">
        <div class="section-title" style="margin-top:0">Ventas mensuales</div>
        ${lineChart(ventasPorMes, { valueFormatter: (v) => formatQ(v) })}
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0">Productos más vendidos</div>
        ${barChart(topProductos)}
      </div>
    </div>

    <div class="grid grid-2 mt-16">
      <div class="card">
        <div class="section-title" style="margin-top:0">Servicios más realizados</div>
        ${barChart(topServicios)}
      </div>
      <div class="card">
        <div class="section-title" style="margin-top:0">Últimos depósitos</div>
        ${ultimosDepositos.length ? `<div class="table-wrap"><table>
            <thead><tr><th>Fecha</th><th>Banco</th><th>Monto</th><th>Usuario</th></tr></thead>
            <tbody>${ultimosDepositos.map((d) => `<tr><td>${escapeHtml(d.fecha)}</td><td>${escapeHtml(d.banco)}</td><td>${formatQ(d.monto)}</td><td>${escapeHtml(d.usuarioNombre)}</td></tr>`).join('')}</tbody>
          </table></div>` : '<div class="empty-state">Sin depósitos recientes.</div>'}
      </div>
    </div>
  `;
}

export default { render };
