import { getAll, addRecord } from '../data.js';
import { addCashMovement } from './cajaCore.js';
import { renderTable, openModal, closeModal, toast, formValues } from '../ui.js';
import { escapeHtml, formatQ, compressImageForFirestore, todayISO, nowTimeHM } from '../utils.js';
import { getCurrentUser } from '../auth.js';

async function render(container) {
  const deposits = await getAll('deposits', { order: 'createdAt', direction: 'desc' });

  const table = renderTable({
    columns: [
      { key: 'fecha', label: 'Fecha' },
      { key: 'banco', label: 'Banco' },
      { key: 'boleta', label: 'No. boleta' },
      { key: 'monto', label: 'Monto', format: (r) => formatQ(r.monto) },
      { key: 'usuarioNombre', label: 'Usuario' },
      { key: 'foto', label: 'Comprobante', format: (r) => r.fotoBase64 ? `<button class="btn btn-secondary btn-sm" data-photo="${r.id}">Ver foto</button>` : '<span class="text-muted">Sin foto</span>' },
    ],
    rows: deposits,
    searchKeys: ['banco', 'boleta', 'usuarioNombre', 'observaciones'],
    emptyMessage: 'Aún no hay depósitos registrados.',
    extraToolbar: `<button class="btn btn-primary btn-sm" id="btn-new">+ Registrar depósito</button>`,
  });

  container.innerHTML = `<div class="card">${table.html}</div>`;
  const card = container.querySelector('.card');
  table.mount(card);

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

  function openDepositForm() {
    let selectedFile = null;
    openModal('Registrar depósito bancario', `
      <form id="dep-form">
        <div class="form-row">
          <label>Banco <input name="banco" required></label>
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

    document.getElementById('dep-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      const saveBtn = document.getElementById('dep-save');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando…';
      try {
        let fotoBase64 = null;
        if (selectedFile) {
          saveBtn.textContent = 'Comprimiendo foto…';
          fotoBase64 = await compressImageForFirestore(selectedFile);
          if (fotoBase64.length > 950000) {
            toast('La foto sigue pesando demasiado incluso comprimida. Intenta con otra foto más simple.', 'danger');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar depósito';
            return;
          }
        }
        saveBtn.textContent = 'Guardando…';
        const user = getCurrentUser();
        const depositId = await addRecord('deposits', {
          fecha: v.fecha || todayISO(), hora: nowTimeHM(), banco: v.banco.trim(), boleta: v.boleta.trim(),
          monto: Number(v.monto), observaciones: v.observaciones.trim(), fotoBase64,
          usuarioId: user.uid, usuarioNombre: user.nombre,
        });
        await addCashMovement({ tipo: 'salida', categoria: 'deposito', monto: Number(v.monto), motivo: `Depósito ${v.banco}`, referenciaId: depositId });
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
