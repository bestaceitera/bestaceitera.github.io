// Avisa cuando el navegador está corriendo una versión vieja del sistema.
//
// GitHub Pages sirve los archivos con `cache-control: max-age=600`, así que
// después de publicar un cambio el navegador puede seguir usando el código viejo
// hasta diez minutos. El CSS se recarga solo porque lleva `?v=` en su enlace,
// pero los módulos de JavaScript no pueden llevarlo: un `import` relativo dentro
// de un módulo no hereda la versión del archivo que lo importó, así que no hay
// forma de estamparlos todos sin un paso de compilación.
//
// Eso deja un hueco peligroso: alguien podía estar cuadrando la caja con la
// fórmula vieja sin saberlo. Nadie debería tener que adivinar si está viendo la
// versión buena. Aquí el sistema lo dice, y ofrece arreglarlo de un clic.
//
// AL PUBLICAR UN CAMBIO hay que subir este número Y el de version.txt. Si se
// olvida, no pasa nada malo: simplemente no aparece el aviso.
export const VERSION = '2026-09-02.1';

const CADA_CUANTO_MS = 15 * 60 * 1000;   // el mostrador deja el sistema abierto todo el día

/** Pregunta al servidor qué versión está publicada, saltándose la caché. */
async function versionPublicada() {
  const res = await fetch(`version.txt?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('sin respuesta');
  return (await res.text()).trim();
}

/**
 * Refresca de verdad los archivos guardados y recarga.
 *
 * `location.reload()` a secas puede volver a usar los módulos de la caché
 * mientras no venzan. `fetch(..., { cache: 'reload' })` sí obliga a ir al
 * servidor y deja el archivo nuevo guardado, así que la recarga siguiente ya
 * levanta el código bueno.
 */
async function actualizar() {
  const archivos = performance.getEntriesByType('resource')
    .map((r) => r.name)
    .filter((n) => n.startsWith(location.origin) && /\.(js|css)(\?|$)/.test(n));
  await Promise.allSettled(archivos.map((n) => fetch(n, { cache: 'reload' })));
  location.reload();
}

function mostrarAviso(nueva) {
  if (document.getElementById('aviso-version')) return;
  const barra = document.createElement('div');
  barra.id = 'aviso-version';
  barra.className = 'aviso-version';
  barra.innerHTML = `
    <span>Estás viendo una versión vieja del sistema (${VERSION}). Ya hay una nueva (${nueva}).</span>
    <button class="btn btn-primary btn-sm" id="aviso-version-btn">Actualizar ahora</button>`;
  document.body.appendChild(barra);
  document.getElementById('aviso-version-btn').addEventListener('click', (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Actualizando…';
    actualizar();
  });
}

async function revisar() {
  try {
    const publicada = await versionPublicada();
    if (publicada && publicada !== VERSION) mostrarAviso(publicada);
  } catch {
    // Sin conexión o sin el archivo: no se avisa nada. Un aviso falso sería peor
    // que no avisar.
  }
}

export function vigilarVersion() {
  revisar();
  setInterval(revisar, CADA_CUANTO_MS);
  // Al volver a la pestaña después de un rato también se revisa: es cuando más
  // probable es que se haya publicado algo mientras tanto.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revisar(); });
}
