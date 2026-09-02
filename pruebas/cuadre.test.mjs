// Pruebas del cuadre del día.
// Correr con:  node pruebas/cuadre.test.mjs
//
// La que más importa es "el orden no cambia el resultado": el mostrador cuenta
// el dinero, lo lleva al banco, registra el depósito y RECIÉN ENTONCES cierra el
// día. Antes, ese orden —el natural— hacía que un día perfecto saliera con
// "sobró Q278", porque el depósito ya estaba restado de lo que se esperaba
// contar.
import { cuadrarPorDia, computeExpected } from '../js/modules/cuadreCore.js';

let fallos = 0;
const ok = (cond, nombre, detalle = '') => {
  console.log(`${cond ? '  ok  ' : '  FALLA'}  ${nombre}${detalle ? '  → ' + detalle : ''}`);
  if (!cond) fallos++;
};
const mov = (categoria, monto, tipo = 'entrada') => ({ fecha: '2026-09-01', tipo, categoria, monto });
const dia = (movs) => cuadrarPorDia(movs)[0];

console.log('\nCuadre del día\n');

// El día real del 1 de septiembre: Q350 en ventas de efectivo, Q72 de vuelto.
const ventasDelDia = [
  mov('venta', 100), mov('venta', 15), mov('venta', 100),
  mov('vuelto', 72, 'salida'), mov('venta', 60), mov('venta', 75),
];
const deposito = mov('deposito', 278, 'salida');

{
  const antes = dia(ventasDelDia);
  const despues = dia([...ventasDelDia, deposito]);
  ok(antes.efectivoDelDia === 278, 'el efectivo del día son las ventas menos los vueltos', `Q${antes.efectivoDelDia}`);
  ok(despues.efectivoDelDia === 278, 'depositar NO cambia lo que hay que contar', `Q${despues.efectivoDelDia}`);
  ok(antes.efectivoDelDia === despues.efectivoDelDia,
     'EL ORDEN NO IMPORTA: cerrar antes o después de depositar da lo mismo');
  ok(antes.aDepositar === 278 && despues.aDepositar === 0,
     'pero lo que falta llevar al banco SÍ baja al depositar',
     `antes Q${antes.aDepositar}, después Q${despues.aDepositar}`);
  ok(despues.depositado === 278, 'y queda constancia de lo ya depositado');
}

// Lo que sale del cajón para gastos sí baja el conteo: ese dinero ya no está.
{
  const conGasto = dia([...ventasDelDia, mov('gasto', 50, 'salida')]);
  ok(conGasto.efectivoDelDia === 228, 'un gasto pagado del cajón sí baja lo que se cuenta', `Q${conGasto.efectivoDelDia}`);
  const conGastoYDeposito = dia([...ventasDelDia, mov('gasto', 50, 'salida'), mov('deposito', 228, 'salida')]);
  ok(conGastoYDeposito.efectivoDelDia === 228, 'y sigue igual después de depositar', `Q${conGastoYDeposito.efectivoDelDia}`);
  ok(conGastoYDeposito.aDepositar === 0, 'con el gasto y el depósito, no queda nada pendiente');
}

// La caja chica vive aparte: no se cuenta ni se deposita.
{
  const conFondo = dia([...ventasDelDia, mov('fondo_inicial', 105)]);
  ok(conFondo.efectivoDelDia === 278, 'la caja chica NO entra en lo que se cuenta', `Q${conFondo.efectivoDelDia}`);
  ok(conFondo.cajaChica === 105, 'pero sí se muestra aparte');
}

// Un depósito parcial deja el resto pendiente.
{
  const parcial = dia([...ventasDelDia, mov('deposito', 100, 'salida')]);
  ok(parcial.efectivoDelDia === 278, 'con depósito parcial, se sigue contando el total del día');
  ok(parcial.aDepositar === 178, 'y queda pendiente lo que falta', `Q${parcial.aDepositar}`);
}

// Un día sin efectivo (todo por transferencia) no inventa nada que depositar.
{
  const sinEfectivo = dia([mov('venta', 0)]);
  ok(sinEfectivo.efectivoDelDia === 0 && sinEfectivo.aDepositar === 0, 'un día sin efectivo no pide depositar nada');
}

// El vuelto no es un gasto: entra y sale, no mueve el neto.
{
  const s = computeExpected([mov('venta', 100), mov('vuelto', 30, 'salida')]);
  ok(s.totalEntradas === 70 && s.totalSalidas === 0,
     'el vuelto se descuenta de ambos lados: entraron 70, no salió nada',
     `entradas ${s.totalEntradas}, salidas ${s.totalSalidas}`);
}

console.log(`\n${fallos ? fallos + ' FALLA(S)' : 'todas las pruebas pasaron'}\n`);
process.exit(fallos ? 1 : 0);
