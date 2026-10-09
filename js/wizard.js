// ── INVOICE WIZARD ────────────────────────────────────────────────────────────
// Drei Schritte: 1. Absender & Konto  2. Empfänger je Teilnehmer  3. Erstellen.
// Eingaben werden lokal im Browser gespeichert (localStorage), damit sie bei
// der nächsten Abrechnung vorausgefüllt sind.

const WIZ_KEY = 'vzev.invoice.v1';

const Wiz = {
  step: 1,
  participants: [],
  data: {
    sender:     { name: 'vZEV Zusammenschluss', street: '', houseNo: '', zip: '', town: '', country: 'CH', contact: '', iban: '' },
    logo:       null,                     // { dataUrl, w, h, format }
    recipients: {},                       // messpunktNr → { include, name, extra, street, houseNo, zip, town, country }
    options:    { days: 30, prefix: 'vZEV' }
  }
};

const SENDER_FIELDS = ['name', 'street', 'houseNo', 'zip', 'town', 'country', 'contact', 'iban'];
const RCPT_FIELDS   = ['name', 'extra', 'street', 'houseNo', 'zip', 'town', 'country'];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── Persistenz ────────────────────────────────────────────────────────────────

function wizLoad() {
  try {
    const raw = localStorage.getItem(WIZ_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    Object.assign(Wiz.data.sender, s.sender || {});
    Object.assign(Wiz.data.options, s.options || {});
    Wiz.data.recipients = s.recipients || {};
    Wiz.data.logo = s.logo || null;
  } catch (e) { /* privater Modus o. ä. – ohne Speicherung weiterarbeiten */ }
}

function wizSave() {
  try {
    localStorage.setItem(WIZ_KEY, JSON.stringify(Wiz.data));
    return true;
  } catch (e) {
    // Meist ein zu grosses Logo – Rest ohne Logo speichern.
    try { localStorage.setItem(WIZ_KEY, JSON.stringify({ ...Wiz.data, logo: null })); } catch (_) {}
    return false;
  }
}

// ── Öffnen / Schliessen ───────────────────────────────────────────────────────

function openInvoiceWizard() {
  const result = AppState.lastResult;
  if (!result) { alert('Bitte zuerst eine Auswertung erstellen.'); return; }

  wizLoad();
  Wiz.participants = invoiceParticipants(result);
  Wiz.participants.forEach(p => {
    const id = p.m.messpunktNr;
    if (!Wiz.data.recipients[id]) Wiz.data.recipients[id] = { include: true, ...recipientFromMeter(p.m) };
  });

  fillSenderForm();
  renderLogoPreview();
  renderRecipients();
  document.getElementById('wizDays').value   = Wiz.data.options.days;
  document.getElementById('wizPrefix').value = Wiz.data.options.prefix;
  document.getElementById('wizDate').value   = isoDate(new Date());

  wizGo(1);
  document.getElementById('invWizard').showModal();
}

function recipientFromMeter(m) {
  const r = { name: m.label || '', extra: '', street: '', houseNo: '', zip: '', town: '', country: 'CH' };
  const a = (m.adresse || '').trim();
  const mm = a.match(/^(.*?)\s+(\d+\s?[a-zA-Z]?)\s*,?\s*(\d{4})\s+(.+)$/);
  if (mm) Object.assign(r, { street: mm[1], houseNo: mm[2], zip: mm[3], town: mm[4] });
  else if (a) {
    const sm = a.match(/^(.*?)\s+(\d+\s?[a-zA-Z]?)$/);
    if (sm) Object.assign(r, { street: sm[1], houseNo: sm[2] }); else r.street = a;
  }
  return r;
}

const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// ── Navigation ────────────────────────────────────────────────────────────────

function wizGo(step) {
  Wiz.step = step;
  document.querySelectorAll('#invWizard [data-panel]').forEach(el => { el.hidden = +el.dataset.panel !== step; });
  document.querySelectorAll('#invWizard .wiz-steps li').forEach(li => {
    const s = +li.dataset.step;
    li.className = s < step ? 'done' : s === step ? 'active' : '';
  });
  document.getElementById('wizBack').style.visibility = step === 1 ? 'hidden' : 'visible';
  const next = document.getElementById('wizNext');
  next.textContent = step < 3 ? 'Weiter' : '';
  if (step === 3) renderOutputList();
  wizShowErrors([]);
  document.querySelector('#invWizard .wiz-body').scrollTop = 0;
}

function wizNext() {
  if (Wiz.step === 3) { downloadAll(); return; }
  const errs = Wiz.step === 1 ? validateSender() : validateRecipients();
  wizShowErrors(errs);
  if (errs.length) return;
  wizSave();
  wizGo(Wiz.step + 1);
}

function wizShowErrors(errs) {
  const el = document.getElementById('wizErr');
  el.innerHTML = errs.length ? errs.map(esc).join('<br>') : '';
  el.hidden = !errs.length;
}

// ── Schritt 1: Absender & Konto ───────────────────────────────────────────────

function fillSenderForm() {
  SENDER_FIELDS.forEach(f => { document.getElementById('ws_' + f).value = Wiz.data.sender[f] || ''; });
  updateIbanHint();
}

function readSenderForm() {
  SENDER_FIELDS.forEach(f => { Wiz.data.sender[f] = document.getElementById('ws_' + f).value.trim(); });
  Wiz.data.sender.country = (Wiz.data.sender.country || 'CH').toUpperCase();
}

function updateIbanHint() {
  const v = document.getElementById('ws_iban').value;
  const el = document.getElementById('ws_iban_hint');
  if (!v.trim()) {
    el.className = 'wiz-hint warn';
    el.textContent = 'Ohne IBAN wird die Rechnung ohne QR-Zahlteil erstellt.';
  } else if (!ibanValid(v)) {
    el.className = 'wiz-hint err';
    el.textContent = 'IBAN ungültig – für QR-Rechnungen sind nur CH- und LI-Konten möglich.';
  } else if (isQrIban(v)) {
    el.className = 'wiz-hint ok';
    el.textContent = `QR-IBAN erkannt · ${ibanFormat(v)} · Zahlungen erhalten eine QR-Referenz.`;
  } else {
    el.className = 'wiz-hint ok';
    el.textContent = `IBAN gültig · ${ibanFormat(v)} · Zahlungen erhalten eine Creditor-Referenz (RF).`;
  }
}

function validateSender() {
  readSenderForm();
  const s = Wiz.data.sender, e = [];
  if (!s.name)  e.push('Name des Rechnungsstellers fehlt.');
  if (!s.street) e.push('Strasse des Rechnungsstellers fehlt.');
  if (!s.zip || !s.town) e.push('PLZ und Ort des Rechnungsstellers fehlen.');
  if (!/^[A-Z]{2}$/.test(s.country)) e.push('Land als 2-stelliger Code (z. B. CH).');
  if (s.iban && !ibanValid(s.iban)) e.push('IBAN ist ungültig.');
  if (s.name.length > 70) e.push('Name max. 70 Zeichen.');
  if (s.town.length > 35) e.push('Ort max. 35 Zeichen.');
  return e;
}

// Logo: auf max. 800 px verkleinern und als PNG ablegen (Transparenz bleibt).
function handleLogoFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) { wizShowErrors(['Logo: bitte PNG, JPG, WebP oder SVG wählen.']); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const s = Math.min(1, 800 / Math.max(img.naturalWidth || 800, img.naturalHeight || 800));
    const w = Math.max(1, Math.round((img.naturalWidth  || 800) * s));
    const h = Math.max(1, Math.round((img.naturalHeight || 300) * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(url);
    Wiz.data.logo = { dataUrl: c.toDataURL('image/png'), w, h, format: 'PNG' };
    const saved = wizSave();
    renderLogoPreview();
    wizShowErrors(saved ? [] : ['Logo ist zu gross zum Speichern – es wird nur für diese Sitzung verwendet.']);
  };
  img.onerror = () => { URL.revokeObjectURL(url); wizShowErrors(['Logo konnte nicht gelesen werden.']); };
  img.src = url;
}

function renderLogoPreview() {
  const box = document.getElementById('wizLogoPreview');
  const rm  = document.getElementById('wizLogoRemove');
  if (Wiz.data.logo?.dataUrl) {
    box.innerHTML = `<img src="${Wiz.data.logo.dataUrl}" alt="Logo">`;
    rm.hidden = false;
  } else {
    // Vorschau des Standard-Logos, wie es drawLogo() ins PDF zeichnet.
    box.innerHTML = `
      <span class="wiz-logo-default">
        <svg width="30" height="30" viewBox="0 0 34 34" aria-hidden="true">
          <rect width="34" height="34" rx="4" fill="#0046B0"/>
          <path d="M8 25L17 9L26 25H8Z" fill="#fff"/>
          <path d="M13 25L17 18L21 25H13Z" fill="#0046B0"/>
          <circle cx="26.5" cy="8" r="2.6" fill="#3AAA6A"/>
        </svg>
        <span><strong>vZEV</strong><small>${esc(Wiz.data.sender.name || 'vZEV Zusammenschluss')}</small></span>
      </span>`;
    rm.hidden = true;
  }
}

// ── Schritt 2: Empfänger ──────────────────────────────────────────────────────

function renderRecipients() {
  const box = document.getElementById('wizRecipients');
  box.innerHTML = Wiz.participants.map((p, i) => {
    const r = Wiz.data.recipients[p.m.messpunktNr];
    const f = (key, label, cls = '', ph = '') => `
      <div class="tfield ${cls}">
        <label for="wr_${i}_${key}">${label}</label>
        <input id="wr_${i}_${key}" data-idx="${i}" data-key="${key}" value="${esc(r[key])}" placeholder="${ph}" autocomplete="off">
      </div>`;
    return `
    <div class="wiz-rcpt ${r.include ? '' : 'off'}" id="wr_${i}">
      <div class="wiz-rcpt-head">
        <label class="wiz-check">
          <input type="checkbox" data-idx="${i}" data-key="include" ${r.include ? 'checked' : ''}>
          <span><strong>${esc(p.m.label || p.m.messpunktNr)}</strong>
          <small>${esc(p.m.zaehlerNr ? 'Zähler ' + p.m.zaehlerNr : p.m.messpunktNr)}</small></span>
        </label>
        <span class="wiz-amount">CHF ${fmtCHF(p.total)}</span>
      </div>
      <div class="wiz-grid">
        ${f('name',    'Name / Firma *', 'span2', 'z. B. Anna Muster')}
        ${f('extra',   'Adresszusatz',   'span2', 'optional, z. B. c/o, Wohnung 2')}
        ${f('street',  'Strasse',        'span-street', 'Musterstrasse')}
        ${f('houseNo', 'Nr.',            'span-no', '7')}
        ${f('zip',     'PLZ *',          'span-zip', '3000')}
        ${f('town',    'Ort *',          'span-town', 'Bern')}
      </div>
    </div>`;
  }).join('');
}

function onRecipientInput(e) {
  const el = e.target;
  if (!el.dataset.key) return;
  const p = Wiz.participants[+el.dataset.idx];
  const r = Wiz.data.recipients[p.m.messpunktNr];
  if (el.dataset.key === 'include') {
    r.include = el.checked;
    document.getElementById('wr_' + el.dataset.idx).classList.toggle('off', !el.checked);
  } else {
    r[el.dataset.key] = el.value.trim();
  }
  wizSave();
}

function validateRecipients() {
  const e = [];
  const inc = Wiz.participants.filter(p => Wiz.data.recipients[p.m.messpunktNr].include);
  if (!inc.length) e.push('Mindestens einen Teilnehmer auswählen.');
  inc.forEach(p => {
    const r = Wiz.data.recipients[p.m.messpunktNr];
    const who = p.m.label || p.m.messpunktNr;
    if (!r.name) e.push(`${who}: Name fehlt.`);
    if (!r.zip || !r.town) e.push(`${who}: PLZ und Ort fehlen.`);
  });
  return e;
}

// ── Schritt 3: Erstellen ──────────────────────────────────────────────────────

function readOptions() {
  const o = Wiz.data.options;
  o.days   = Math.max(0, parseInt(document.getElementById('wizDays').value, 10) || 30);
  o.prefix = (document.getElementById('wizPrefix').value.trim() || 'vZEV').replace(/[^0-9A-Za-z-]/g, '');
  const d  = document.getElementById('wizDate').value;
  const invDate = d ? new Date(d + 'T00:00:00') : new Date();
  const dueDate = new Date(invDate); dueDate.setDate(dueDate.getDate() + o.days);
  return { invDate, dueDate };
}

// Liefert für jeden ausgewählten Teilnehmer den vollständigen Rechnungskontext.
function invoiceJobs() {
  readSenderForm();
  const { invDate, dueDate } = readOptions();
  const { periodStart, periodEnd } = AppState.lastResult;
  const stamp = isoDate(invDate).replace(/-/g, '');
  return Wiz.participants
    .filter(p => Wiz.data.recipients[p.m.messpunktNr].include)
    .map((p, i) => {
      const invNr = `${Wiz.data.options.prefix}-${stamp}-${String(i + 1).padStart(3, '0')}`;
      const recipient = Wiz.data.recipients[p.m.messpunktNr];
      return {
        p,
        ctx: {
          sender: Wiz.data.sender, recipient, logo: Wiz.data.logo,
          invNr, invDate, dueDate, periodStart, periodEnd,
          ...invoiceReference(Wiz.data.sender.iban, invNr)
        }
      };
    });
}

function renderOutputList() {
  const jobs = invoiceJobs();
  const qrOk = ibanValid(Wiz.data.sender.iban);
  document.getElementById('wizQrInfo').innerHTML = qrOk
    ? mkAlert('as', `Jede Rechnung enthält einen Swiss QR-Zahlteil auf <strong>${esc(ibanFormat(Wiz.data.sender.iban))}</strong>.`)
    : mkAlert('aw', 'Keine gültige IBAN erfasst – die Rechnungen werden <strong>ohne QR-Zahlteil</strong> erstellt.');

  document.getElementById('wizOutput').innerHTML = jobs.map(({ p, ctx }, i) => `
    <div class="wiz-out-row">
      <div class="wiz-out-main">
        <strong>${esc(ctx.recipient.name)}</strong>
        <small>${esc(p.m.label)} · ${esc(ctx.invNr)}</small>
      </div>
      <span class="wiz-amount">CHF ${fmtCHF(p.total)}</span>
      <div class="wiz-out-actions">
        <button type="button" class="btn btn-outline btn-sm" data-act="preview" data-idx="${i}">Vorschau</button>
        <button type="button" class="btn btn-outline btn-sm" data-act="download" data-idx="${i}">PDF</button>
      </div>
    </div>`).join('');

  const total = jobs.reduce((s, j) => s + j.p.total, 0);
  document.getElementById('wizOutTotal').textContent = `${jobs.length} Rechnung${jobs.length !== 1 ? 'en' : ''} · Total CHF ${fmtCHF(total)}`;
  document.getElementById('wizNext').textContent = jobs.length > 1 ? `Alle ${jobs.length} herunterladen` : 'PDF herunterladen';
}

const fileSlug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^0-9A-Za-z]+/g, '_').replace(/^_|_$/g, '');

function makeDoc(job) {
  return buildInvoiceDoc(job.p, job.ctx);
}

function onOutputClick(e) {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const job = invoiceJobs()[+btn.dataset.idx];
  try {
    const doc = makeDoc(job);
    if (btn.dataset.act === 'preview') window.open(doc.output('bloburl'), '_blank');
    else doc.save(`Rechnung_${job.ctx.invNr}_${fileSlug(job.ctx.recipient.name)}.pdf`);
    wizShowErrors([]);
  } catch (err) {
    console.error(err);
    wizShowErrors([`PDF konnte nicht erstellt werden: ${err.message}`]);
  }
}

// Browser fragen beim ersten Mehrfach-Download einmal nach Erlaubnis.
async function downloadAll() {
  wizSave();
  const jobs = invoiceJobs();
  for (const job of jobs) {
    makeDoc(job).save(`Rechnung_${job.ctx.invNr}_${fileSlug(job.ctx.recipient.name)}.pdf`);
    await new Promise(r => setTimeout(r, 450));
  }
}

// ── Verdrahtung ───────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const dlg = document.getElementById('invWizard');
  if (!dlg) return;
  document.getElementById('wizNext').addEventListener('click', wizNext);
  document.getElementById('wizBack').addEventListener('click', () => wizGo(Math.max(1, Wiz.step - 1)));
  document.getElementById('wizClose').addEventListener('click', () => { wizSave(); dlg.close(); });
  dlg.addEventListener('cancel', () => wizSave());

  SENDER_FIELDS.forEach(f => document.getElementById('ws_' + f).addEventListener('input', () => {
    readSenderForm();
    if (f === 'iban') updateIbanHint();
    if (f === 'name' && !Wiz.data.logo) renderLogoPreview();
    wizSave();
  }));
  document.getElementById('wizLogoFile').addEventListener('change', e => handleLogoFile(e.target.files[0]));
  document.getElementById('wizLogoRemove').addEventListener('click', () => {
    Wiz.data.logo = null; wizSave(); renderLogoPreview();
    document.getElementById('wizLogoFile').value = '';
  });

  const rc = document.getElementById('wizRecipients');
  rc.addEventListener('input', onRecipientInput);
  rc.addEventListener('change', onRecipientInput);

  ['wizDays', 'wizPrefix', 'wizDate'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => { readOptions(); wizSave(); renderOutputList(); }));
  document.getElementById('wizOutput').addEventListener('click', onOutputClick);
});
