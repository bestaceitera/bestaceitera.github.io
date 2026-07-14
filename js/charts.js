import { escapeHtml } from './utils.js';

const COLORS = ['#1f6f5c', '#2563a8', '#b8860b', '#c0392b', '#6b4fa0', '#1f8f4e'];

/** Gráfica de barras verticales en SVG. data = [{label, value}] */
export function barChart(data, { height = 220, valueFormatter = (v) => v } = {}) {
  if (!data.length || data.every((d) => !d.value)) return `<div class="empty-state">Sin datos para graficar</div>`;
  const max = Math.max(...data.map((d) => d.value), 1);
  const barW = 100 / data.length;
  const bars = data.map((d, i) => {
    const h = (d.value / max) * (height - 40);
    const x = i * barW;
    const y = height - 30 - h;
    return `
      <g>
        <rect x="${x + barW * 0.15}%" y="${y}" width="${barW * 0.7}%" height="${h}" rx="4" fill="${COLORS[i % COLORS.length]}">
          <title>${escapeHtml(d.label)}: ${escapeHtml(String(valueFormatter(d.value)))}</title>
        </rect>
        <text x="${x + barW * 0.5}%" y="${height - 10}" font-size="10" text-anchor="middle" fill="#6b7684">${escapeHtml(d.label)}</text>
        <text x="${x + barW * 0.5}%" y="${y - 4}" font-size="10" text-anchor="middle" fill="#1c2530">${escapeHtml(String(valueFormatter(d.value)))}</text>
      </g>`;
  }).join('');
  return `<svg viewBox="0 0 100 ${height}" width="100%" height="${height}" preserveAspectRatio="none" style="overflow:visible">${bars}</svg>`;
}

/** Gráfica de línea simple en SVG. data = [{label, value}] */
export function lineChart(data, { height = 220, valueFormatter = (v) => v } = {}) {
  if (!data.length || data.every((d) => !d.value)) return `<div class="empty-state">Sin datos para graficar</div>`;
  const max = Math.max(...data.map((d) => d.value), 1);
  const stepX = data.length > 1 ? 100 / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = data.length > 1 ? i * stepX : 50;
    const y = height - 30 - (d.value / max) * (height - 40);
    return { x, y, d };
  });
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const dots = points.map((p) => `
      <circle cx="${p.x}" cy="${p.y}" r="1.6" fill="#1f6f5c">
        <title>${escapeHtml(p.d.label)}: ${escapeHtml(String(valueFormatter(p.d.value)))}</title>
      </circle>
      <text x="${p.x}" y="${height - 10}" font-size="10" text-anchor="middle" fill="#6b7684">${escapeHtml(p.d.label)}</text>`).join('');
  return `<svg viewBox="0 0 100 ${height}" width="100%" height="${height}" preserveAspectRatio="none" style="overflow:visible">
      <path d="${path}" fill="none" stroke="#1f6f5c" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${dots}
    </svg>`;
}
