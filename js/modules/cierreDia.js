// Cerrar el día y marcar el dinero como depositado, desde la pantalla de Ventas.
//
// El cuadre de Caja solo sirve para HOY. Estos dos formularios trabajan sobre
// CUALQUIER día, que es lo que hace falta cuando se cargan ventas atrasadas o
// cuando el depósito se hace al día siguiente.
import { addRecord, updateRecord, removeRecord, getAll } from '../data.js';
import { addCashMovement } from './cajaCore.js';
import { openModal, closeModal, toast } from '../ui.js';
import { escapeHtml, formatQ, round2, formatDateLong, nowTimeHM, compressImageForFirestore } from '../utils.js';
import { getCurrentUser } from '../auth.js';
import { etiquetaBanco } from './bancos.js';
import { guardarBoleta, traerBoleta, tieneBoleta, borrarBoleta } from './boletas.js';

/**
 * Cierra un día: se cuenta el efectivo físico y se guarda si cuadró, faltó o sobró.
 * @param {string} fecha    día en formato AAAA-MM-DD
 * @param {object} dia      resultado de cuadrarPorDia para ese día
 * @param {object} cierre   cierre ya existente, si el día ya se cerró antes
 */
export function abrirCierreDia({ fecha, dia, cierre, cierresPrevios = 0, onSaved }) {
  // Al cerrar se cuenta SOLO el dinero de las ventas del día. La caja chica es un
  // monto fijo que vive aparte, no se deposita y no se cuenta aquí.
  const esperado = dia?.efectivoVentas ?? 0;

  const cajaChica = dia?.cajaChica ?? 0;

  if (cierre) {
    openModal(`Día cerrado — ${formatDateLong(fecha)}`, `
      <p>Debía haber <b>${formatQ(cierre.esperado)}</b> · Se contaron <b>${formatQ(cierre.contado)}</b></p>
      <div class="cuadre-aviso ${cierre.estado === 'cuadrada' ? 'ok' : cierre.estado === 'sobrante' ? 'sobra' : 'falta'}">
        ${cierre.estado === 'cuadrada' ? '✓ <b>La caja cuadró exactamente.</b>'
          : cierre.estado === 'sobrante' ? `<b>Sobraron ${formatQ(cierre.diferencia)}</b>`
          : `<b>Faltaron ${formatQ(Math.abs(cierre.diferencia))}</b>`}
      </div>
      ${cierre.observaciones ? `<p class="text-muted mt-16">${escapeHtml(cierre.observaciones)}</p>` : ''}
      <p class="text-muted" style="font-size:12.5px">Cerrado por ${escapeHtml(cierre.usuarioNombre || '')}.</p>

      <div class="reabrir-box">
        <b>¿No cuadra algo?</b> Si te diste cuenta de una venta que faltaba registrar,
        o de un gasto que no anotaste, puedes reabrir el día para volver a cerrarlo.
        <label class="mt-16">¿Por qué lo reabres?
          <input id="cd-motivo" autocomplete="off" placeholder="ej. faltaba registrar una venta de Q80">
        </label>
        <button type="button" class="btn btn-secondary btn-block" id="cd-reabrir">Reabrir día</button>
      </div>

      <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancel-form">Cerrar</button></div>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);

    document.getElementById('cd-reabrir').addEventListener('click', async () => {
      const motivo = document.getElementById('cd-motivo').value.trim();
      if (!motivo) {
        toast('Escribe por qué lo reabres, para que quede la razón anotada.', 'danger');
        document.getElementById('cd-motivo').focus(); return;
      }
      const btn = document.getElementById('cd-reabrir');
      btn.disabled = true;
      btn.textContent = 'Reabriendo…';
      try {
        const user = getCurrentUser();
        // El cierre NO se borra: se marca como anulado. Si se borrara, un faltante
        // podría desaparecer cerrando y reabriendo hasta que "cuadre", y nadie se
        // enteraría. Así queda el rastro de qué decía antes y por qué se reabrió.
        await updateRecord('cashClosings', cierre.id, {
          anulado: true,
          motivoReapertura: motivo,
          reabiertoPor: user?.nombre || '',
          reabiertoEn: new Date().toISOString(),
        });
        toast('Día reabierto. Corrige lo que falte y vuelve a cerrarlo.', 'success', 6000);
        closeModal();
        if (onSaved) onSaved();
      } catch (err) {
        toast('No se pudo reabrir el día: ' + err.message, 'danger', 6000);
        btn.disabled = false;
        btn.textContent = 'Reabrir día';
      }
    });
    return;
  }

  openModal(`Cerrar día — ${formatDateLong(fecha)}`, `
    ${cierresPrevios > 0 ? `<div class="aviso-foto">
      Este día ya se había cerrado ${cierresPrevios === 1 ? 'una vez' : `${cierresPrevios} veces`} y se reabrió.
      El cierre anterior queda guardado con su motivo.
    </div>` : ''}
    <div class="card" style="margin-bottom:14px">
      <table style="width:100%">
        <tr><td>Recibiste por ventas</td><td class="text-right">${formatQ(dia?.ventas ?? 0)}</td></tr>
        <tr><td>Recibiste por servicios</td><td class="text-right">${formatQ(dia?.servicios ?? 0)}</td></tr>
        <tr><td>Otros ingresos</td><td class="text-right">${formatQ(dia?.otrosIngresos ?? 0)}</td></tr>
        <tr><td>Vueltos que diste</td><td class="text-right">− ${formatQ(dia?.vueltos ?? 0)}</td></tr>
        <tr><td>Gastos y compras</td><td class="text-right">− ${formatQ(round2((dia?.gastos ?? 0) + (dia?.compras ?? 0)))}</td></tr>
        <tr><td>Retiros</td><td class="text-right">− ${formatQ(dia?.retiros ?? 0)}</td></tr>
        <tr><td>Depósitos ya hechos</td><td class="text-right">− ${formatQ(dia?.depositos ?? 0)}</td></tr>
        <tr style="font-weight:700;border-top:1px solid var(--border)">
          <td>Efectivo de las ventas del día</td><td class="text-right">${formatQ(esperado)}</td></tr>
      </table>
      <p class="text-muted" style="font-size:12.5px;margin:10px 0 0">
        La caja chica de ${formatQ(dia?.cajaChica ?? 0)} <b>no entra en esta cuenta</b>:
        es un monto fijo que se queda aparte. Cuenta solo el dinero de las ventas.
      </p>
    </div>

    <!-- Las dos únicas cosas que hay que hacer con las manos: apartar la caja
         chica y depositar el resto. Antes aquí decía "devolver a caja chica
         Q128" suponiendo que el cambio salía de esos billetes; con Q105 de caja
         chica eso era imposible y solo confundía. De qué pila salió cada billete
         da igual: al final se aparta lo de mañana y lo demás va al banco. -->
    <div class="devolver-caja-chica">
      <span>Aparta para mañana <span class="text-muted">— la caja chica</span></span>
      <b>${formatQ(cajaChica)}</b>
    </div>

    <div class="depositar-banco">
      <span>Depositar a banco</span>
      <b>${formatQ(dia?.aDepositar ?? 0)}</b>
    </div>

    <label>¿Cuánto contaste de las ventas? (Q)
      <input type="number" id="cd-contado" min="0" step="0.01" placeholder="0.00">
    </label>
    <div id="cd-aviso"></div>
    <label>Observaciones (opcional)
      <textarea id="cd-obs" rows="2" placeholder="ej. faltó por un vuelto mal dado"></textarea>
    </label>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
      <button type="button" class="btn btn-primary" id="cd-save">Cerrar día</button>
    </div>
  `);

  const $ = (id) => document.getElementById(id);
  $('cancel-form').addEventListener('click', closeModal);

  // Aviso en vivo: apenas escribe el conteo ya sabe si cuadra, falta o sobra.
  $('cd-contado').addEventListener('input', () => {
    const aviso = $('cd-aviso');
    if ($('cd-contado').value === '') { aviso.innerHTML = ''; return; }
    const dif = round2((Number($('cd-contado').value) || 0) - esperado);
    aviso.innerHTML = dif === 0
      ? `<div class="cuadre-aviso ok">✓ <b>La caja cuadra exactamente.</b></div>`
      : dif < 0
        ? `<div class="cuadre-aviso falta"><b>Faltan ${formatQ(Math.abs(dif))}</b><br>Hay que reponerlos a la caja.</div>`
        : `<div class="cuadre-aviso sobra"><b>Sobran ${formatQ(dif)}</b><br>Revisa qué venta no se registró.</div>`;
  });

  $('cd-save').addEventListener('click', async () => {
    const valor = $('cd-contado').value;
    if (valor === '' || isNaN(Number(valor)) || Number(valor) < 0) {
      toast('Escribe cuánto dinero contaste.', 'danger'); $('cd-contado').focus(); return;
    }
    const contado = Number(valor);
    const diferencia = round2(contado - esperado);
    const estado = diferencia === 0 ? 'cuadrada' : diferencia > 0 ? 'sobrante' : 'faltante';
    const btn = $('cd-save');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const user = getCurrentUser();
      await addRecord('cashClosings', {
        fecha, esperado, contado, diferencia, estado,
        cajaChica: dia?.cajaChica ?? 0, ventas: dia?.ventas ?? 0, servicios: dia?.servicios ?? 0,
        gastos: dia?.gastos ?? 0, compras: dia?.compras ?? 0, retiros: dia?.retiros ?? 0,
        depositos: dia?.depositos ?? 0, vueltos: dia?.vueltos ?? 0,
        observaciones: $('cd-obs').value.trim(),
        // Cuántas veces se había cerrado antes: deja ver de un vistazo si un día
        // costó cuadrar, sin tener que ir a buscar los cierres anulados.
        reintentos: cierresPrevios,
        usuarioId: user?.uid || null, usuarioNombre: user?.nombre || '',
      });
      toast(estado === 'cuadrada' ? '¡Día cerrado y cuadrado!'
        : estado === 'sobrante' ? `Día cerrado. Sobraron ${formatQ(diferencia)}`
        : `Día cerrado. Faltaron ${formatQ(Math.abs(diferencia))}`,
        estado === 'faltante' ? 'danger' : 'success', 6000);
      closeModal();
      if (onSaved) onSaved();
    } catch (err) {
      toast('No se pudo cerrar el día: ' + err.message, 'danger', 6000);
      btn.disabled = false;
      btn.textContent = 'Cerrar día';
    }
  });
}

/**
 * Registra que el dinero de un día ya se llevó al banco.
 * Crea el depósito CON LA FECHA DE ESE DÍA, para que salga de la caja de ese día
 * y no de la de hoy.
 */
export function abrirDepositoDia({ fecha, dia, bancos = [], onSaved }) {
  const sugerido = dia?.aDepositar ?? 0;
  const yaDepositado = dia?.depositado ?? 0;

  openModal(`Depositar — ${formatDateLong(fecha)}`, `
    <div class="card" style="background:var(--primary-light);border-color:var(--primary);margin-bottom:14px">
      Del efectivo de este día, <b>${formatQ(sugerido)}</b> están pendientes de llevar al banco.
      La caja chica de <b>${formatQ(dia?.cajaChica ?? 0)}</b> se queda en el negocio.
      ${yaDepositado > 0 ? `<br><span class="text-muted">Ya se habían depositado ${formatQ(yaDepositado)} de este día.</span>` : ''}
    </div>
    <div class="form-row">
      <label>Banco ${bancos.length
        ? `<select id="dd-banco"><option value="">— Elige la cuenta —</option>${bancos.map((b) => `<option value="${escapeHtml(b.nombre)}" data-cuenta="${escapeHtml(b.numeroCuenta || '')}">${escapeHtml(etiquetaBanco(b))}</option>`).join('')}</select>`
        : `<input id="dd-banco" autocomplete="off" placeholder="Agrégalos en Almacén → Bancos">`}</label>
      <label>No. de boleta (opcional) <input id="dd-boleta" autocomplete="off"></label>
    </div>
    <label>Monto depositado (Q)
      <input type="number" id="dd-monto" min="0.01" step="0.01" value="${sugerido || ''}">
    </label>
    <label>Foto de la boleta
      <input type="file" id="dd-foto" accept="image/*" capture="environment">
    </label>
    <img id="dd-preview" class="photo-preview" hidden>
    <div id="dd-aviso"></div>
    <label>Observaciones (opcional) <textarea id="dd-obs" rows="2"></textarea></label>
    <div class="modal-actions">
      <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
      <button type="button" class="btn btn-primary" id="dd-save">Registrar depósito</button>
    </div>
  `);

  const $ = (id) => document.getElementById(id);
  $('cancel-form').addEventListener('click', closeModal);

  let archivo = null;
  $('dd-foto').addEventListener('change', () => {
    archivo = $('dd-foto').files[0] || null;
    const prev = $('dd-preview');
    if (archivo) { prev.src = URL.createObjectURL(archivo); prev.hidden = false; $('dd-aviso').innerHTML = ''; }
    else { prev.hidden = true; }
  });

  // Avisar de la foto faltante SIN bloquear: el depósito ya se hizo en el banco,
  // así que impedir registrarlo dejaría la caja descuadrada por un trámite. Se
  // registra igual, marcado como pendiente de comprobante, y el reporte lo lista
  // para que después se le tome la foto.
  let avisado = false;

  $('dd-save').addEventListener('click', async () => {
    const banco = $('dd-banco').value.trim();
    const monto = Number($('dd-monto').value);
    if (!banco) { toast('Escribe a qué banco se depositó.', 'danger'); $('dd-banco').focus(); return; }
    if (!monto || monto <= 0) { toast('Escribe cuánto se depositó.', 'danger'); $('dd-monto').focus(); return; }

    if (!archivo && !avisado) {
      avisado = true;
      $('dd-aviso').innerHTML = `<div class="aviso-foto">
        ⚠ <b>Todavía no subiste la foto de la boleta.</b><br>
        Súbela arriba, o vuelve a tocar el botón para registrarlo sin ella.
        Va a quedar en la lista de <b>comprobantes pendientes</b> hasta que se agregue.
      </div>`;
      $('dd-save').textContent = 'Registrar sin foto';
      $('dd-save').classList.add('btn-sin-foto');
      toast('Falta la foto de la boleta.', 'info', 5000);
      return;
    }

    const btn = $('dd-save');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      let fotoBase64 = null;
      if (archivo) {
        btn.textContent = 'Procesando foto…';
        try {
          fotoBase64 = await compressImageForFirestore(archivo);
        } catch {
          // Si la imagen falla, el depósito se guarda igual: lo importante es que
          // el dinero quede registrado, la foto se puede agregar después.
          fotoBase64 = null;
          toast('No se pudo procesar la foto; el depósito se guardará sin comprobante.', 'info', 5000);
        }
        btn.textContent = 'Guardando…';
      }
      const user = getCurrentUser();
      const depositId = await addRecord('deposits', {
        fecha, hora: nowTimeHM(), banco,
        bancoCuenta: $('dd-banco').selectedOptions?.[0]?.dataset.cuenta || '',
        boleta: $('dd-boleta').value.trim(),
        monto, observaciones: $('dd-obs').value.trim(), tieneFoto: !!fotoBase64,
        usuarioId: user?.uid || null, usuarioNombre: user?.nombre || '',
      });
      // La foto va en su propia colección: dentro del depósito haría pesada cada
      // consulta de depósitos, aunque nadie la esté mirando.
      await guardarBoleta(depositId, fotoBase64);
      // La salida de caja lleva la fecha DEL DÍA depositado, no la de hoy: si no,
      // registrar hoy el depósito de ayer descuadraría la caja de hoy.
      await addCashMovement({
        tipo: 'salida', categoria: 'deposito', monto,
        motivo: `Depósito ${banco}`, referenciaId: depositId, fecha,
      });
      toast(archivo
        ? `Depósito de ${formatQ(monto)} registrado con su foto.`
        : `Depósito de ${formatQ(monto)} registrado. Falta subir la foto de la boleta.`,
        archivo ? 'success' : 'info', 6000);
      closeModal();
      if (onSaved) onSaved();
    } catch (err) {
      toast('No se pudo registrar el depósito: ' + err.message, 'danger', 6000);
      btn.disabled = false;
      btn.textContent = 'Registrar depósito';
    }
  });
}

/**
 * Los depósitos de un día, con su boleta, sin salir de Ventas.
 *
 * Antes había que ir hasta Depósitos bancarios a buscar la foto, y un depósito
 * cargado al banco equivocado o con la boleta cambiada no se podía deshacer.
 * Borrar uno elimina TAMBIÉN su salida de caja: si quedara suelta, el día
 * seguiría diciendo que ese dinero ya salió al banco y no cuadraría nunca.
 */
export function abrirDepositosDelDia({ fecha, depositos = [], onSaved }) {
  let lista = [...depositos];
  let huboCambios = false;

  const filas = () => lista.map((d) => `
    <div class="deposito-item">
      <div class="deposito-datos">
        <b>${formatQ(d.monto)}</b> — ${escapeHtml(d.banco || 'sin banco')}
        ${d.bancoCuenta ? `<span class="text-muted">· ${escapeHtml(d.bancoCuenta)}</span>` : ''}
        <div class="text-muted" style="font-size:12.5px">
          ${d.boleta ? `Boleta ${escapeHtml(d.boleta)} · ` : ''}${escapeHtml(d.hora || '')}${d.usuarioNombre ? ` · ${escapeHtml(d.usuarioNombre)}` : ''}
        </div>
        ${d.observaciones ? `<div class="text-muted" style="font-size:12.5px">${escapeHtml(d.observaciones)}</div>` : ''}
      </div>
      ${tieneBoleta(d)
        ? `<img class="deposito-foto" data-zoom="${d.id}" alt="Boleta del depósito" title="Tócala para verla grande" loading="lazy" decoding="async">`
        : '<div class="deposito-sinfoto">Sin foto<br>de la boleta</div>'}
      <button type="button" class="btn btn-danger btn-sm" data-borrar="${d.id}">Eliminar</button>
    </div>`).join('');

  openModal(`Depósitos — ${formatDateLong(fecha)}`, `
    <div id="dl-lista">${filas()}</div>
    <p class="text-muted" style="font-size:12.5px">
      Si te equivocaste de banco o de boleta, elimina el depósito y vuelve a
      registrarlo. Al eliminarlo, ese dinero vuelve a contarse como pendiente de depositar.
    </p>
    <div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancel-form">Cerrar</button></div>
  `);

  const cerrar = () => { closeModal(); if (huboCambios && onSaved) onSaved(); };
  document.getElementById('cancel-form').addEventListener('click', cerrar);

  // Las boletas se bajan aquí, solo cuando alguien abre esta lista. Si viajaran
  // dentro del depósito, cada consulta de depósitos de todo el sistema cargaría
  // con ellas aunque nadie las mire.
  const pintarBoletas = async () => {
    for (const d of lista) {
      const img = document.querySelector(`#dl-lista [data-zoom="${d.id}"]`);
      if (!img || img.src) continue;
      const foto = await traerBoleta(d.id, d);
      if (foto && img.isConnected) img.src = foto;
    }
  };
  pintarBoletas();

  document.getElementById('dl-lista').addEventListener('click', async (e) => {
    const foto = e.target.closest('[data-zoom]');
    if (foto) { foto.classList.toggle('grande'); return; }

    const btn = e.target.closest('[data-borrar]');
    if (!btn) return;
    const dep = lista.find((d) => d.id === btn.dataset.borrar);
    if (!dep) return;

    // La confirmación va en el mismo botón y no en un diálogo aparte: solo hay
    // un modal a la vez, así que un confirmDialog cerraría esta lista y ya no
    // habría dónde volver. Dos toques: el primero avisa, el segundo borra.
    if (btn.dataset.confirmar !== 'si') {
      document.querySelectorAll('#dl-lista [data-borrar]').forEach((otro) => {
        otro.dataset.confirmar = 'no';
        otro.textContent = 'Eliminar';
        otro.classList.remove('btn-confirmar');
      });
      btn.dataset.confirmar = 'si';
      btn.textContent = '¿Seguro? Toca otra vez';
      btn.classList.add('btn-confirmar');
      toast('Al eliminarlo, ese dinero vuelve a quedar pendiente de depositar.', 'info', 5000);
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Eliminando…';
    try {
      // Primero el rastro en caja y luego el depósito: si algo falla a media
      // operación, es preferible que sobre el depósito (visible y borrable de
      // nuevo) a que quede una salida de caja sin dueño, que nadie encontraría.
      const movs = await getAll('cashMovements', { filters: [['referenciaId', '==', dep.id]] });
      for (const m of movs) await removeRecord('cashMovements', m.id);
      await removeRecord('deposits', dep.id);
      await borrarBoleta(dep.id);
      lista = lista.filter((d) => d.id !== dep.id);
      huboCambios = true;
      toast(`Depósito de ${formatQ(dep.monto)} eliminado.`, 'success', 5000);
      if (!lista.length) { cerrar(); return; }
      // Si cerraron el modal con Escape mientras se borraba, ya no hay lista que
      // repintar; el cambio igual se avisó y la pantalla se recarga al cerrar.
      const cont = document.getElementById('dl-lista');
      if (cont) { cont.innerHTML = filas(); pintarBoletas(); }
    } catch (err) {
      toast('No se pudo eliminar el depósito: ' + err.message, 'danger', 6000);
      btn.disabled = false;
      btn.textContent = 'Eliminar';
    }
  });
}
