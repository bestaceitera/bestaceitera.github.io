// Prueba del tope de tiempo que se pausa con la pestaña dormida.
// Correr con:  node pruebas/esperaConPausa.test.mjs
import { conTiempoLimite } from '../js/esperaConPausa.js';

let fallos = 0;
const ok = (cond, nombre, detalle = '') => {
  console.log(`${cond ? '  ok  ' : '  FALLA'}  ${nombre}${detalle ? '  → ' + detalle : ''}`);
  if (!cond) fallos++;
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una pestaña de mentira que se puede esconder y mostrar a voluntad. */
function pantallaFalsa(oculta = false) {
  const oyentes = new Set();
  return {
    hidden: oculta,
    addEventListener: (_, fn) => oyentes.add(fn),
    removeEventListener: (_, fn) => oyentes.delete(fn),
    esconder() { this.hidden = true; oyentes.forEach((f) => f()); },
    mostrar() { this.hidden = false; oyentes.forEach((f) => f()); },
    get oyentes() { return oyentes.size; },
  };
}

console.log('\nTope de tiempo con pausa\n');

// 1. Lo normal: si la respuesta llega a tiempo, pasa.
{
  const r = await conTiempoLimite(Promise.resolve('datos'), 'x', { ms: 100, pantalla: pantallaFalsa() });
  ok(r === 'datos', 'deja pasar una respuesta que llega a tiempo');
}

// 2. Con la pestaña a la vista, expira.
{
  let error = null;
  try { await conTiempoLimite(new Promise(() => {}), 'ventas', { ms: 60, pantalla: pantallaFalsa() }); }
  catch (e) { error = e.message; }
  ok(/ventas.*tardó demasiado/.test(error || ''), 'con la pestaña a la vista SÍ expira', error);
}

// 3. EL CASO QUE ROMPIA: pestaña dormida todo el tiempo -> NO expira.
{
  const p = pantallaFalsa(true);
  let expiro = false;
  const carrera = conTiempoLimite(new Promise(() => {}), 'ventas', { ms: 50, pantalla: p })
    .catch(() => { expiro = true; });
  await dormir(300);   // seis veces el tope
  ok(!expiro, 'con la pestaña dormida NO expira, aunque pase seis veces el tope');
  void carrera;
}

// 4. Se esconde a media espera: solo cuenta el tiempo que estuvo a la vista.
{
  const p = pantallaFalsa(false);
  let expiro = false;
  conTiempoLimite(new Promise(() => {}), 'ventas', { ms: 120, pantalla: p }).catch(() => { expiro = true; });
  await dormir(60);    // consumió ~60 de los 120
  p.esconder();
  await dormir(400);   // dormida: no debe contar
  ok(!expiro, 'el reloj se pausa al esconderse la pestaña');
  p.mostrar();         // le quedaban ~60 ms
  await dormir(30);
  ok(!expiro, 'al volver, sigue con lo que le quedaba (todavía no expira)');
  await dormir(120);
  ok(expiro, 'y expira cuando se acaba el tiempo que le quedaba');
}

// 5. No deja basura: el oyente se quita al terminar.
{
  const p = pantallaFalsa();
  await conTiempoLimite(Promise.resolve(1), 'x', { ms: 100, pantalla: p });
  ok(p.oyentes === 0, 'quita el oyente de visibilidad al terminar bien');
  const p2 = pantallaFalsa();
  await conTiempoLimite(Promise.reject(new Error('no')), 'x', { ms: 100, pantalla: p2 }).catch(() => {});
  ok(p2.oyentes === 0, 'y también cuando falla');
}

console.log(`\n${fallos ? fallos + ' FALLA(S)' : 'todas las pruebas pasaron'}\n`);
process.exit(fallos ? 1 : 0);
