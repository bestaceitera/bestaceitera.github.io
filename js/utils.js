export const IVA_RATE = 0.12;

export function formatQ(amount) {
  const n = Number(amount) || 0;
  return 'Q ' + n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function calcIVA(subtotal) {
  return round2(subtotal * IVA_RATE);
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

export function formatDate(value) {
  if (!value) return '';
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(value) {
  if (!value) return '';
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('es-GT', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' });
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

export function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

/** Redimensiona y comprime una imagen en el navegador antes de subirla. */
export function compressImage(file, maxDim = 1000, quality = 0.7) {
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
export async function compressImageForFirestore(file, { maxBytes = 900000 } = {}) {
  const attempts = [
    { maxDim: 1600, quality: 0.85 },
    { maxDim: 1400, quality: 0.75 },
    { maxDim: 1100, quality: 0.65 },
    { maxDim: 900, quality: 0.55 },
    { maxDim: 700, quality: 0.45 },
    { maxDim: 500, quality: 0.35 },
    { maxDim: 350, quality: 0.25 },
    { maxDim: 220, quality: 0.15 },
  ];
  let dataUrl = null;
  for (const { maxDim, quality } of attempts) {
    const blob = await compressImage(file, maxDim, quality);
    dataUrl = await blobToDataURL(blob);
    if (dataUrl.length <= maxBytes) return dataUrl;
  }
  return dataUrl;
}
