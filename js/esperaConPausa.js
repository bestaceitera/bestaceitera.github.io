// Un tope de tiempo que NO corre mientras la pestaña está dormida.
//
// Vive aparte de data.js por dos razones: no depende de Firebase, y así se puede
// probar de verdad —con una pestaña de mentira— en vez de confiar en que está
// bien. La prueba está en pruebas/esperaConPausa.test.mjs.
//
// El problema que resuelve: el navegador congela las pestañas que no se están
// viendo. Si alguien deja el sistema abierto, se va a otra pestaña y vuelve diez
// minutos después, la consulta que quedó a medias no avanzó ni un milisegundo,
// pero un cronómetro normal sí habría contado los diez minutos. Se veía un
// "la consulta tardó demasiado; revisa la conexión" en un sistema que estaba
// perfectamente bien, y la única salida era recargar la página.

export const TIEMPO_MAXIMO_MS = 8000;

/**
 * @param {Promise} promesa   lo que se está esperando
 * @param {string}  que       nombre para el mensaje de error
 * @param {Object}  opciones  { ms, pantalla } — `pantalla` se inyecta en las pruebas
 */
export function conTiempoLimite(promesa, que, { ms = TIEMPO_MAXIMO_MS, pantalla = globalThis.document } = {}) {
  return new Promise((cumplir, fallar) => {
    let restante = ms;
    let arrancoEn = 0;
    let reloj = null;
    let yaTermino = false;

    const pausar = () => {
      if (reloj === null) return;
      clearTimeout(reloj);
      reloj = null;
      restante -= Date.now() - arrancoEn;
    };
    const seguir = () => {
      if (yaTermino || reloj !== null || pantalla?.hidden) return;
      arrancoEn = Date.now();
      reloj = setTimeout(() => {
        yaTermino = true;
        limpiar();
        fallar(new Error(`la consulta de ${que} tardó demasiado`));
      }, Math.max(0, restante));
    };
    const alCambiarVisibilidad = () => (pantalla?.hidden ? pausar() : seguir());
    const limpiar = () => {
      pausar();
      pantalla?.removeEventListener?.('visibilitychange', alCambiarVisibilidad);
    };

    pantalla?.addEventListener?.('visibilitychange', alCambiarVisibilidad);
    seguir();
    promesa.then(
      (valor) => { if (!yaTermino) { yaTermino = true; limpiar(); cumplir(valor); } },
      (error) => { if (!yaTermino) { yaTermino = true; limpiar(); fallar(error); } },
    );
  });
}
