import { getByDateRange, addRecord } from '../data.js';
import { addCashMovement } from './cajaCore.js';
import { renderTable, openModal, closeModal, toast, formValues, dateRangePresetButtons, applyRangePreset, bindRangeControls } from '../ui.js';
import { escapeHtml, formatQ, compressImageForFirestore, todayISO, nowTimeHM } from '../utils.js';
import { getCurrentUser } from '../auth.js';
import { listarBancos, etiquetaBanco } from './bancos.js';

// El período elegido se guarda fuera de render() para que no se pierda cuando la
// pantalla se refresca sola al llegar un cambio desde otro dispositivo.
let rangoGuardado = null;
let presetGuardado = 'mes';

async function render(container) {
  // Cada depósito lleva dentro la foto del comprobante, así que traer "los
  // últimos 200" significaría descargar decenas de megas. Se piden solo los del
  // período que se está viendo: un mes de depósitos pesa poco y carga al instante.
  let rango = rangoGuardado || applyRangePreset('mes');
  let peticion = 0;
  const primera = await getByDateRange('deposits', rango, { max: 300 });
  let deposits = primera.filas;

  const table = renderTable({
    columns: [
      { key: 'fecha', label: 'Fecha' },
      { key: 'banco', label: 'Banco', format: (r) => escapeHtml(r.banco || '')
          + (r.bancoCuenta ? ` <span class="num-cuenta">${escapeHtml(r.bancoCuenta)}</span>` : '') },
      { key: 'boleta', label: 'No. boleta' },
      { key: 'monto', label: 'Monto', format: (r) => formatQ(r.monto) },
      { key: 'usuarioNombre', label: 'Usuario' },
      { key: 'foto', label: 'Comprobante', format: (r) => r.fotoBase64 ? `<button class="btn btn-secondary btn-sm" data-photo="${r.id}">Ver foto</button>` : '<span class="text-muted">Sin foto</span>' },
    ],
    rows: deposits,
    searchKeys: ['banco', 'boleta', 'usuarioNombre', 'observaciones'],
    emptyMessage: 'No hubo depósitos en las fechas seleccionadas.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Registrar depósito</button>`,
  });

  container.innerHTML = `
    <div class="toolbar" id="dep-fechas" style="margin-bottom:10px">${dateRangePresetButtons({ conAyer: true })}</div>
    <div class="card">${table.html}</div>`;
  const card = container.querySelector('.card');
  const tabla = table.mount(card);

  bindRangeControls(container.querySelector('#dep-fechas'), async (r, preset) => {
    const mio = ++peticion;
    rango = r; rangoGuardado = r; presetGuardado = preset;
    tabla.refresh([]);
    try {
      const res = await getByDateRange('deposits', rango, { max: 300 });
      if (mio !== peticion) return;
      deposits = res.filas;
    } catch (err) {
      if (mio !== peticion) return;
      deposits = [];
      toast('No se pudieron cargar los depósitos: ' + err.message, 'danger', 6000);
    }
    tabla.refresh(deposits);
  }, { activo: presetGuardado });

  card.querySelector('#btn-new').addEventListener('click', openDepositForm);
  card.addEventListener('click', (e) => {
    const id = e.target.dataset.photo;
    if (id) {
      const dep = deposits.find((d) => d.id === id);
      openModal(`Comprobante — ${dep.banco}`, `
        <img src="${dep.fotoBase64}" class="photo-preview" style="max-width:100%">
        <p class="mt-16 text-muted">${escapeHtml(dep.observaciones || '')}</p>
      `);
    }
  });

  async function openDepositForm() {
    let selectedFile = null;
    // El banco se elige del catálogo para que el control por banco cuadre: escrito
    // a mano, "Banrural" y "banrural" quedarían como dos bancos distintos.
    const bancos = await listarBancos();
    openModal('Registrar depósito bancario', `
      <form id="dep-form">
        <div class="form-row">
          <label>Banco ${bancos.length
            ? `<select name="banco" required><option value="">— Elige la cuenta —</option>${bancos.map((b) => `<option value="${escapeHtml(b.nombre)}" data-cuenta="${escapeHtml(b.numeroCuenta || '')}">${escapeHtml(etiquetaBanco(b))}</option>`).join('')}</select>`
            : `<input name="banco" required placeholder="Agrégalos en Almacén → Bancos">`}</label>
          <label>No. de boleta (opcional) <input name="boleta"></label>
        </div>
        <div class="form-row">
          <label>Fecha <input type="date" name="fecha" value="${todayISO()}"></label>
          <label>Monto (Q) <input type="number" name="monto" min="0.01" step="0.01" required></label>
        </div>
        <label>Observaciones <textarea name="observaciones" rows="2"></textarea></label>
        <label>Foto del comprobante (boleta / captura de transferencia)
          <input type="file" name="foto" accept="image/*" capture="environment">
        </label>
        <img id="dep-preview" class="photo-preview" hidden>
        <div id="dep-aviso"></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" id="cancel-form">Cancelar</button>
          <button type="submit" class="btn btn-primary" id="dep-save">Guardar depósito</button>
        </div>
      </form>
    `);
    document.getElementById('cancel-form').addEventListener('click', closeModal);
    const fileInput = document.querySelector('#dep-form [name="foto"]');
    fileInput.addEventListener('change', () => {
      selectedFile = fileInput.files[0] || null;
      const preview = document.getElementById('dep-preview');
      if (selectedFile) {
        preview.src = URL.createObjectURL(selectedFile);
        preview.hidden = false;
      } else {
        preview.hidden = true;
      }
    });

    // Igual que al depositar desde Ventas: si falta la foto se avisa, pero no se
    // bloquea. El dinero ya se depositó; impedir registrarlo descuadraría la caja.
    let avisado = false;
    document.getElementById('dep-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const saveBtn = document.getElementById('dep-save');
      if (!selectedFile && !avisado) {
        avisado = true;
        document.getElementById('dep-aviso').innerHTML = `<div class="aviso-foto">
          ⚠ <b>Todavía no subiste la foto de la boleta.</b><br>
          Súbela arriba, o vuelve a tocar el botón para registrarlo sin ella.
          Va a quedar en la lista de <b>comprobantes pendientes</b> hasta que se agregue.
        </div>`;
        saveBtn.textContent = 'Guardar sin foto';
        saveBtn.classList.add('btn-sin-foto');
        toast('Falta la foto de la boleta.', 'info', 5000);
        return;
      }
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando…';
      try {
        let fotoBase64 = null;
        if (selectedFile) {
          saveBtn.textContent = 'Procesando foto…';
          try {
            fotoBase64 = await compressImageForFirestore(selectedFile);
          } catch {
            fotoBase64 = null; // si algo sale mal con la imagen, el depósito se guarda igual, sin foto
            toast('No se pudo procesar la foto; el depósito se guardará sin comprobante.', 'info');
          }
        }
        saveBtn.textContent = 'Guardando…';
        const user = getCurrentUser();
        const depositId = await addRecord('deposits', {
          fecha: v.fecha || todayISO(), hora: nowTimeHM(), banco: v.banco.trim(),
          bancoCuenta: document.querySelector('#dep-form [name="banco"]')?.selectedOptions?.[0]?.dataset.cuenta || '',
          boleta: v.boleta.trim(),
          monto: Number(v.monto), observaciones: v.observaciones.trim(), fotoBase64,
          usuarioId: user.uid, usuarioNombre: user.nombre,
        });
        // El movimiento de caja tiene que llevar la MISMA fecha del depósito. Si no,
        // registrar hoy el depósito de ayer restaría el dinero del efectivo de hoy,
        // que ya no lo tiene: la caja de hoy saldría faltante sin razón.
        await addCashMovement({ tipo: 'salida', categoria: 'deposito', monto: Number(v.monto), motivo: `Depósito ${v.banco}`, referenciaId: depositId, fecha: v.fecha || todayISO() });
        toast('Depósito registrado correctamente.', 'success');
        closeModal();
        render(container);
      } catch (err) {
        toast('No se pudo registrar el depósito: ' + err.message, 'danger');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar depósito';
      }
    });
  }
}

export default { render };
