import { getAll, countRecords } from '../data.js';
import { formatQ, todayISO, round2, escapeHtml } from '../utils.js';
import { barChart, lineChart } from '../charts.js';
import { stockBajoHtml, productosBajoMinimo } from './stockBajo.js';
import { computeExpected } from './cuadreCore.js';

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
  // Mismo criterio que el panel de abajo, para que el número y la lista no se contradigan.
  const lowStock = productosBajoMinimo(products);

  // El efectivo se calcula con la misma función que usa Caja, no con una cuenta
  // aparte. Antes el dashboard sumaba por su cuenta y no descontaba los vueltos:
  // el total coincidía de casualidad (el vuelto se cancela solo), pero cualquier
  // cambio en una de las dos cuentas habría hecho que el dashboard y Caja
  // dijeran cifras distintas del mismo dinero.
  //
  // La consulta ya viene filtrada por la fecha de hoy desde el servidor, así que
  // no hace falta volver a filtrarla aquí.
  const { esperado: efectivoEsperado } = computeExpected(cashMovementsToday);

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

    <div class="mt-16">${stockBajoHtml(products, { max: 8 })}</div>

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
