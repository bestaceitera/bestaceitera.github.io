import { formatDateTime } from './utils.js';
import { toast } from './ui.js';

/* ------------------------- Librerias bajo demanda -------------------------
 * jsPDF, autotable y SheetJS pesan ~290 KB juntos. Estaban en tres <script> del
 * index.html, asi que se descargaban SIEMPRE al abrir el sistema —el 37% de todo
 * lo que baja el arranque— aunque nadie fuera a exportar nada ese dia. Ademas
 * eran scripts clasicos, que frenan el armado de la pagina hasta que llegan: con
 * la senal del taller lenta, eso es la pantalla en blanco durando de mas.
 *
 * Ahora se bajan la PRIMERA vez que alguien toca un boton de exportar. Se piden
 * una sola vez aunque se toquen varios botones seguidos, y si fallan se avisa en
 * vez de dejar el boton sin hacer nada.
 */
const CDN = 'https://cdnjs.cloudflare.com/ajax/libs';
const FUENTES = {
  jspdf:     `${CDN}/jspdf/2.5.1/jspdf.umd.min.js`,
  autotable: `${CDN}/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js`,
  xlsx:      `${CDN}/xlsx/0.18.5/xlsx.full.min.js`,
};

function bajarScript(src) {
  return new Promise((listo, falla) => {
    // Si ya esta puesto (por ejemplo, de una version anterior del index), no se repite.
    const puesto = document.querySelector(`script[src="${src}"]`);
    if (puesto) {
      if (puesto.dataset.listo) return listo();
      puesto.addEventListener('load', () => listo());
      puesto.addEventListener('error', () => falla(new Error('no se pudo descargar la libreria')));
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.addEventListener('load', () => { el.dataset.listo = '1'; listo(); });
    el.addEventListener('error', () => falla(new Error('no se pudo descargar la libreria; revisa la conexion')));
    document.head.appendChild(el);
  });
}

let pidiendoPdf = null;
let pidiendoExcel = null;

/** autotable se cuelga de jsPDF, asi que tiene que llegar DESPUES: van en fila a proposito. */
function librosPdf() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API?.autoTable) return Promise.resolve();
  if (!pidiendoPdf) {
    pidiendoPdf = bajarScript(FUENTES.jspdf)
      .then(() => bajarScript(FUENTES.autotable))
      .catch((err) => { pidiendoPdf = null; throw err; });   // que un fallo no deje el boton muerto para siempre
  }
  return pidiendoPdf;
}

function librosExcel() {
  if (window.XLSX) return Promise.resolve();
  if (!pidiendoExcel) {
    pidiendoExcel = bajarScript(FUENTES.xlsx).catch((err) => { pidiendoExcel = null; throw err; });
  }
  return pidiendoExcel;
}

/**
 * Exporta un arreglo de filas a PDF (tabla) usando jsPDF + autotable.
 * columns: [{ key, label }]
 */
function exportPDF({ title, subtitle = '', columns, rows, filename }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait' });
  doc.setFontSize(14);
  doc.text(title, 14, 16);
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(subtitle || `Generado: ${formatDateTime(new Date())}`, 14, 22);
  doc.autoTable({
    startY: 28,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => String(r[c.key] ?? ''))),
    styles: { fontSize: 8.5, cellPadding: 3 },
    headStyles: { fillColor: [31, 111, 92] },
    alternateRowStyles: { fillColor: [244, 246, 248] },
  });
  doc.save(`${filename}.pdf`);
}

/**
 * Excel no acepta cualquier nombre de hoja: prohíbe : \ / ? * [ ] y limita a 31
 * caracteres. Si no se limpia, el archivo no se genera y el botón parece "no hacer nada".
 */
function nombreHojaValido(nombre) {
  const limpio = String(nombre || 'Datos').replace(/[:\\/?*[\]]/g, '-').trim();
  return limpio.slice(0, 31) || 'Datos';
}

/** Exporta un arreglo de filas a un archivo .xlsx real usando SheetJS. */
function exportExcel({ sheetName = 'Datos', columns, rows, filename }) {
  const data = rows.map((r) => {
    const obj = {};
    columns.forEach((c) => { obj[c.label] = r[c.key] ?? ''; });
    return obj;
  });
  const ws = window.XLSX.utils.json_to_sheet(data);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, nombreHojaValido(sheetName));
  window.XLSX.writeFile(wb, `${filename}.xlsx`);
}

/** Devuelve el HTML de los dos botones de exportación listos para insertar en un toolbar. */
export function exportButtonsHtml() {
  return `
    <button class="btn btn-secondary btn-sm" data-export="pdf">⬇ PDF</button>
    <button class="btn btn-secondary btn-sm" data-export="excel">⬇ Excel</button>
  `;
}

/** Engancha los botones de exportación dentro de `container` a los datos actuales (rows puede ser una función). */
export function bindExportButtons(container, { title, columns, getRows, filename }) {
  // Si algo falla, el usuario debe enterarse: un botón que no hace nada es peor que un error.
  const proteger = (traerLibreria, fn, que) => async (e) => {
    const boton = e.currentTarget;
    const rotulo = boton.textContent;
    try {
      const rows = getRows();
      if (!rows.length) { toast('No hay datos para exportar en este período.', 'info'); return; }
      // La primera vez hay que bajar la librería: el botón lo dice en vez de
      // quedarse mudo mientras llega.
      boton.disabled = true;
      boton.textContent = 'Preparando…';
      await traerLibreria();
      fn(rows);
    } catch (err) {
      console.error('export', err);
      toast(`No se pudo generar el ${que}: ${err.message}`, 'danger', 6000);
    } finally {
      boton.disabled = false;
      boton.textContent = rotulo;
    }
  };
  container.querySelector('[data-export="pdf"]')?.addEventListener('click',
    proteger(librosPdf, (rows) => exportPDF({ title, columns, rows, filename }), 'PDF'));
  container.querySelector('[data-export="excel"]')?.addEventListener('click',
    proteger(librosExcel, (rows) => exportExcel({ sheetName: title, columns, rows, filename }), 'Excel'));
}
