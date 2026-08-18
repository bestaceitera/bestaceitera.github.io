export function formatQ(amount) {
  const n = Number(amount) || 0;
  return 'Q ' + n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

export function nowTimeHM() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

export function formatDateTime(value) {
  if (!value) return '';
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Convierte "2026-08-04" en "Hoy", "Ayer" o "martes 4 de agosto de 2026".
 * Se arma la fecha a mano para que no se corra un día por la zona horaria.
 */
/**
 * Fecha larga para pantalla: "Hoy", "Ayer" o "Viernes, 14 de agosto de 2026".
 *
 * `relativo: false` fuerza la fecha completa. Es lo que usan los reportes que se
 * exportan: un PDF archivado que dice "Hoy" no dice nada la semana siguiente, y
 * es justo el papel que se guarda para la planilla.
 */
export function formatDateLong(iso, { relativo = true } = {}) {
  if (!iso) return '';
  const [a, m, d] = String(iso).split('-').map(Number);
  if (!a || !m || !d) return iso;
  if (relativo && iso === todayISO()) return 'Hoy';
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const ayerISO = new Date(ayer - ayer.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (relativo && iso === ayerISO) return 'Ayer';
  const fecha = new Date(a, m - 1, d);
  const texto = fecha.toLocaleDateString('es-GT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/** Redimensiona y comprime una imagen en el navegador antes de subirla. */
function compressImage(file, maxDim = 1000, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

/**
 * Comprime una foto y la devuelve como data URL (base64) lista para guardar
 * directamente en un documento de Firestore, probando progresivamente más
 * compresión hasta quedar bajo maxBytes (Firestore limita cada documento a 1MiB).
 * El último intento es agresivo a propósito para GARANTIZAR que siempre quepa
 * (nunca debe fallar el guardado por una foto pesada).
 */
export async function compressImageForFirestore(file, { maxBytes = 70000 } = {}) {
  // Una boleta es texto negro sobre papel blanco: se lee perfectamente a ~900px
  // con calidad media. Se apuntaba a 200KB y salían de 140 a 180KB cada una;
  // bajando a 70KB se leen igual de bien y pesan la tercera parte, que es lo que
  // se descarga y se guarda cada vez.
  const attempts = [
    { maxDim: 1200, quality: 0.65 },
    { maxDim: 1000, quality: 0.6 },
    { maxDim: 900, quality: 0.55 },
    { maxDim: 800, quality: 0.5 },
    { maxDim: 700, quality: 0.45 },
    { maxDim: 600, quality: 0.4 },
    { maxDim: 450, quality: 0.3 },
    { maxDim: 300, quality: 0.2 },
  ];
  let dataUrl = null;
  for (const { maxDim, quality } of attempts) {
    const blob = await compressImage(file, maxDim, quality);
    dataUrl = await blobToDataURL(blob);
    if (dataUrl.length <= maxBytes) return dataUrl;
  }
  return dataUrl;
}
