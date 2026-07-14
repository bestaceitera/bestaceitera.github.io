import { formatDateTime } from './utils.js';

/**
 * Exporta un arreglo de filas a PDF (tabla) usando jsPDF + autotable (cargados por CDN en index.html).
 * columns: [{ key, label }]
 */
export function exportPDF({ title, subtitle = '', columns, rows, filename }) {
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

/** Exporta un arreglo de filas a un archivo .xlsx real usando SheetJS (cargado por CDN). */
export function exportExcel({ sheetName = 'Datos', columns, rows, filename }) {
  const data = rows.map((r) => {
    const obj = {};
    columns.forEach((c) => { obj[c.label] = r[c.key] ?? ''; });
    return obj;
  });
  const ws = window.XLSX.utils.json_to_sheet(data);
  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, sheetName);
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
  container.querySelector('[data-export="pdf"]')?.addEventListener('click', () => {
    exportPDF({ title, columns, rows: getRows(), filename });
  });
  container.querySelector('[data-export="excel"]')?.addEventListener('click', () => {
    exportExcel({ sheetName: title, columns, rows: getRows(), filename });
  });
}
