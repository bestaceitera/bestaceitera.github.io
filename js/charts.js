import { escapeHtml } from './utils.js';

const COLORS = ['#1e4fa0', '#2f80c7', '#f3b200', '#d8232a', '#6b4fa0', '#1f8f4e'];

/**
 * Barras horizontales en HTML. Se usan para nombres largos (productos, servicios):
 * la etiqueta se lee de corrido a la izquierda y el texto usa la fuente real de la
 * página, sin deformarse como pasaba al estirar un SVG.
 */
export function barChart(data, { valueFormatter = (v) => v } = {}) {
  if (!data.length || data.every((d) => !d.value)) return `<div class="empty-state">Sin datos para graficar</div>`;
  const max = Math.max(...data.map((d) => d.value), 1);
  const filas = data.map((d, i) => {
    const pct = Math.max(2, (d.value / max) * 100);
    const valor = escapeHtml(String(valueFormatter(d.value)));
    return `
      <div class="hbar-row" title="${escapeHtml(d.label)}: ${valor}">
        <span class="hbar-label">${escapeHtml(d.label)}</span>
        <span class="hbar-track"><span class="hbar-fill" style="width:${pct}%;background:${COLORS[i % COLORS.length]}"></span></span>
        <b class="hbar-value">${valor}</b>
      </div>`;
  }).join('');
  return `<div class="hbars">${filas}</div>`;
}

/**
 * Gráfica de línea en SVG con proporción real (sin estirar), así los textos
 * conservan su forma. El viewBox usa coordenadas de verdad y el SVG escala
 * completo, manteniendo la proporción.
 */
export function lineChart(data, { height = 240, valueFormatter = (v) => v } = {}) {
  if (!data.length || data.every((d) => !d.value)) return `<div class="empty-state">Sin datos para graficar</div>`;

  const W = 640;
  const H = height;
  const padX = 46;          // espacio para que la primera y última etiqueta no se corten
  const padTop = 34;        // espacio para el valor encima del punto
  const padBottom = 30;     // espacio para el nombre del mes
  const innerW = W - padX * 2;
  const innerH = H - padTop - padBottom;

  const max = Math.max(...data.map((d) => d.value), 1);
  const puntos = data.map((d, i) => ({
    x: data.length > 1 ? padX + (innerW / (data.length - 1)) * i : W / 2,
    y: padTop + innerH - (d.value / max) * innerH,
    d,
  }));

  const linea = puntos.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${linea} L ${puntos[puntos.length - 1].x.toFixed(1)} ${padTop + innerH} L ${puntos[0].x.toFixed(1)} ${padTop + innerH} Z`;

  const marcas = puntos.map((p) => `
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5" fill="#fff" stroke="#1e4fa0" stroke-width="2.5"/>
      <text x="${p.x.toFixed(1)}" y="${(p.y - 13).toFixed(1)}" font-size="13" font-weight="700" text-anchor="middle"
            fill="#1c2530" stroke="#fff" stroke-width="3.5" paint-order="stroke">${escapeHtml(String(valueFormatter(p.d.value)))}</text>
      <text x="${p.x.toFixed(1)}" y="${H - 9}" font-size="13" text-anchor="middle" fill="#6b7684">${escapeHtml(p.d.label)}</text>`).join('');

  // El contenedor con scroll evita que en celular el texto quede diminuto:
  // la gráfica conserva un ancho mínimo legible y se desliza de lado.
  return `<div class="chart-scroll"><svg viewBox="0 0 ${W} ${H}" width="100%" class="chart-svg" role="img">
      <line x1="${padX - 10}" y1="${padTop + innerH}" x2="${W - padX + 10}" y2="${padTop + innerH}" stroke="#e2e5ea" stroke-width="1.5"/>
      <path d="${area}" fill="#1e4fa0" opacity="0.08"/>
      <path d="${linea}" fill="none" stroke="#1e4fa0" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${marcas}
    </svg></div>`;
}
