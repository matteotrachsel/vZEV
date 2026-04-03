// ── UI ────────────────────────────────────────────────────────────────────────
// Handles upload, meter configuration UI, tariff inputs, and wizard steps.
// No inline event handlers – all wired via addEventListener.

document.addEventListener('DOMContentLoaded', () => {
  setupUpload();
  setupStaticHandlers();

  // Auto-recalculate when tariff inputs change (only if data is loaded).
  document.querySelectorAll('#feedInPrice,#pvshareAbo,#grundtarif,#energyAllIn,#vzevPrice')
    .forEach(el => el.addEventListener('change', () => {
      if (AppState.parsedData.length) calculateAndRender();
    }));

  // Event delegation for dynamically generated meter config cards.
  const grid = document.getElementById('meterConfigGrid');
  grid.addEventListener('change', e => {
    const sel = e.target.closest('select[id^="typ_"]');
    if (sel) {
      const idx = parseInt(sel.id.replace('typ_', ''), 10);
      updateTypeStyle(sel, idx);
    }
  });
  grid.addEventListener('click', e => {
    const btn = e.target.closest('.mp-delete-btn');
    if (btn) {
      const card = btn.closest('.meter-cfg-card');
      if (card) card.style.display = 'none';
    }
  });
});

function setupStaticHandlers() {
  document.getElementById('calculateBtn').addEventListener('click', calculateAndRender);
  document.getElementById('exportBtn').addEventListener('click', exportCSV);
  document.getElementById('pdfBtn').addEventListener('click', exportPDF);
  document.getElementById('tariffFileInput').addEventListener('change', function() {
    if (this.files[0]) loadTariffFromJSON(this.files[0]);
  });
  document.getElementById('tariffSelect').addEventListener('change', applySelectedTariff);
}

// ── Wizard step indicator ─────────────────────────────────────────────────────

function setStep(n) {
  [1, 2, 3].forEach(i => {
    const el = document.getElementById('step' + i);
    el.className = 'step' + (i < n ? ' done' : i === n ? ' active' : '');
  });
}

// ── File upload ───────────────────────────────────────────────────────────────

function setupUpload() {
  const zone  = document.getElementById('uploadZone');
  const input = document.getElementById('fileInput');

  zone.addEventListener('click',     () => input.click());
  zone.addEventListener('dragover',  e  => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop',      e  => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => {
    if (input.files[0]) processFile(input.files[0]);
  });
}

async function processFile(file) {
  const st = document.getElementById('uploadStatus');
  st.className = '';
  st.innerHTML = mkAlert('ai', `Verarbeite <strong>${file.name}</strong>…`);
  try {
    const rows = await readExcel(file);
    AppState.parsedData = parseRows(rows);
    if (!AppState.parsedData.length) {
      st.innerHTML = mkAlert('aw', 'Keine gültigen Daten gefunden. Bitte Dateiformat prüfen.');
      return;
    }
    AppState.detectedMPs = [...new Set(AppState.parsedData.map(r => r.messpunkt))].sort();
    const n = AppState.detectedMPs.length;
    st.innerHTML = mkAlert('as',
      `${AppState.parsedData.length.toLocaleString('de-CH')} Datenpunkte · ` +
      `${n} Messpunkt${n !== 1 ? 'e' : ''} erkannt aus <strong>${file.name}</strong>`
    );
    buildMeterConfig();
    document.getElementById('results').classList.add('hidden');
    setStep(2);
  } catch (e) {
    st.innerHTML = mkAlert('ae', `Fehler beim Einlesen: ${e.message}`);
    console.error(e);
  }
}

// ── Meter configuration UI ────────────────────────────────────────────────────

function buildMeterConfig() {
  const card   = document.getElementById('meterConfigCard');
  const grid   = document.getElementById('meterConfigGrid');
  const infoEl = document.getElementById('meterConfigInfo').querySelector('span:last-child');

  const knownFound = AppState.detectedMPs.filter(mp =>
    KNOWN.some(k => k.messpunktNr === mp || mp.includes(k.messpunktNr) || k.messpunktNr.includes(mp))
  );
  infoEl.innerHTML =
    `${AppState.detectedMPs.length} Messpunkt${AppState.detectedMPs.length !== 1 ? 'e' : ''} in der Datei gefunden.` +
    (knownFound.length
      ? ` <strong>${knownFound.length} bekannte${knownFound.length === 1 ? 'r' : ''} Messpunkt${knownFound.length !== 1 ? 'e' : ''}</strong> automatisch vorausgefüllt.`
      : '') +
    ' Typ und Bezeichnung prüfen, dann <em>Auswertung erstellen</em> klicken.';

  grid.innerHTML = AppState.detectedMPs.map((mp, i) => {
    const known    = KNOWN.find(k => k.messpunktNr === mp || mp.includes(k.messpunktNr) || k.messpunktNr.includes(mp));
    const typ      = known?.typ      || 'Verbrauch';
    const isPrio   = known?.priority || false;
    const label    = known?.label    || '';
    const adresse  = known?.adresse  || '';
    const zaehlerNr = known?.zaehlerNr || '';

    const mData = AppState.parsedData.filter(r => r.messpunkt === mp);
    const totalB = mData.reduce((s, r) => s + r.bezug, 0);
    const totalE = mData.reduce((s, r) => s + r.einspeisung, 0);
    const dMin   = new Date(Math.min(...mData.map(r => r.datum.getTime())));
    const dMax   = new Date(Math.max(...mData.map(r => r.datum.getTime())));

    return `
    <div class="meter-cfg-card" id="card_${i}">
      <button class="mp-delete-btn" title="Messpunkt entfernen" type="button">×</button>
      ${known ? '<span class="found-badge">✓ Bekannt</span>' : ''}
      <div class="mpid">${mp}</div>
      <div class="cfg-row">
        <div style="flex:0 0 130px">
          <label>Typ</label>
          <div class="type-sel">
            <select id="typ_${i}">
              <option value="Verbrauch"  ${typ === 'Verbrauch'  ? 'selected' : ''}>↓ Verbrauch</option>
              <option value="Produktion" ${typ === 'Produktion' ? 'selected' : ''}>☀ Produktion</option>
              <option value="ignore">— Ignorieren</option>
            </select>
          </div>
        </div>
        <div style="flex:1;min-width:110px">
          <label>Bezeichnung</label>
          <input type="text" id="label_${i}" value="${label}" placeholder="z. B. Ogimatte 10">
        </div>
      </div>
      <div class="cfg-row">
        <div style="flex:1">
          <label>Adresse</label>
          <input type="text" id="adresse_${i}" value="${adresse}" placeholder="Adresse Messpunkt">
        </div>
        <div style="flex:0 0 110px">
          <label>Zählernummer</label>
          <input type="text" id="zaehler_${i}" value="${zaehlerNr}" placeholder="z. B. 10781966">
        </div>
      </div>
      <div class="meter-stats">
        ${mData.length.toLocaleString('de-CH')} Messwerte &nbsp;·&nbsp; ${fmt(dMin)} – ${fmt(dMax)}
        ${totalB > 0 ? `&nbsp;·&nbsp; Bezug: <strong>${totalB.toFixed(1)} kWh</strong>` : ''}
        ${totalE > 0 ? `&nbsp;·&nbsp; Einspeisung: <strong>${totalE.toFixed(1)} kWh</strong>` : ''}
      </div>
    </div>`;
  }).join('');

  // Apply initial select styling after rendering.
  AppState.detectedMPs.forEach((_, i) => {
    const sel = document.getElementById('typ_' + i);
    if (sel) updateTypeStyle(sel, i);
  });

  card.classList.remove('hidden');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateTypeStyle(sel, idx) {
  sel.className = sel.value.toLowerCase();
}

// ── Config readers (used by calculator.js) ────────────────────────────────────

function getMeterConfig() {
  return AppState.detectedMPs.map((mp, i) => {
    const card = document.getElementById('card_' + i);
    if (card && card.style.display === 'none') return null; // deleted by user
    return {
      messpunktNr: mp,
      typ:         document.getElementById('typ_' + i)?.value || 'Verbrauch',
      label:       document.getElementById('label_' + i)?.value.trim()   || mp.slice(-8),
      adresse:     document.getElementById('adresse_' + i)?.value.trim() || '',
      zaehlerNr:   document.getElementById('zaehler_' + i)?.value.trim() || ''
    };
  }).filter(m => m && m.typ !== 'ignore');
}

function getTariff() {
  const energyAllIn = parseFloat(document.getElementById('energyAllIn').value) / 100;  // CHF/kWh all-in
  const vzevPrice   = parseFloat(document.getElementById('vzevPrice').value)   / 100;  // CHF/kWh internal solar
  const grundtarif  = parseFloat(document.getElementById('grundtarif').value);          // CHF/month per meter
  const pvshareAbo  = parseFloat(document.getElementById('pvshareAbo').value);          // CHF/month per meter
  const feedIn      = parseFloat(document.getElementById('feedInPrice').value) / 100;  // CHF/kWh feed-in
  const splitBase   = document.getElementById('splitBase_prop')?.checked || false;
  return { energyAllIn, vzevPrice, grundtarif, pvshareAbo, feedIn, splitBase };
}

// ── BKW tariff JSON loader ────────────────────────────────────────────────────

async function loadTariffFromJSON(file) {
  const statusEl = document.getElementById('tariffFetchStatus');
  statusEl.innerHTML = mkAlert('ai', `Lade <strong>${file.name}</strong>…`);
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    AppState.tariffJSON = data;

    const tariffs = (data.tariffs || []).filter(t => t.tariffType === 'electricity');
    if (!tariffs.length) {
      statusEl.innerHTML = mkAlert('aw', 'Keine Stromtarife in der Datei gefunden.');
      return;
    }

    const sel = document.getElementById('tariffSelect');
    sel.innerHTML = '<option value="">Tarif wählen…</option>' +
      tariffs.map((t, i) => `<option value="${i}">${t.tariffName}</option>`).join('');
    sel.style.display = '';
    sel.value = '';

    const dso = data.dsoName || file.name;
    statusEl.innerHTML = mkAlert('as',
      `<strong>${dso}</strong> geladen · ${tariffs.length} Tarife verfügbar · Tarif rechts wählen`
    );
  } catch (e) {
    statusEl.innerHTML = mkAlert('ae', `Fehler beim Laden der Tarifdatei: ${e.message}`);
  }
}

function applySelectedTariff() {
  const statusEl = document.getElementById('tariffFetchStatus');
  const sel   = document.getElementById('tariffSelect');
  const idx   = parseInt(sel.value, 10);
  if (isNaN(idx) || !AppState.tariffJSON) return;

  const tariff = (AppState.tariffJSON.tariffs || []).filter(t => t.tariffType === 'electricity')[idx];
  if (!tariff) return;

  const basePrice    = tariff.prices?.base?.price;
  const energyPrices = tariff.prices?.energy || [];
  // For multilevel (HT/NT), use the daytime (HT) price (from 07:00); fallback to first.
  const htEntry = energyPrices.find(e => e.from === '07:00') || energyPrices[0];
  const energyPrice = htEntry?.price; // CHF/kWh

  if (basePrice != null) document.getElementById('grundtarif').value = basePrice.toFixed(2);

  const parts = [`Tarif <strong>${tariff.tariffName}</strong>`];
  if (basePrice   != null) parts.push(`Grundtarif: ${basePrice.toFixed(2)} CHF/Mt.`);
  if (energyPrice != null) parts.push(`Energiepreis (BKW): ${(energyPrice * 100).toFixed(2)} Rp/kWh`);
  statusEl.innerHTML = mkAlert('as', parts.join(' · '));

  if (AppState.parsedData.length) calculateAndRender();
}

// ── Invoice header config ─────────────────────────────────────────────────────

function getInvoiceHeader() {
  return {
    name:        document.getElementById('invSenderName')?.value.trim()    || 'vZEV Ogimatte',
    street:      document.getElementById('invSenderStreet')?.value.trim()  || '',
    city:        document.getElementById('invSenderCity')?.value.trim()    || '',
    contact:     document.getElementById('invSenderContact')?.value.trim() || '',
    iban:        document.getElementById('invIBAN')?.value.trim()          || '',
    paymentTerm: document.getElementById('invPaymentTerm')?.value.trim()   || '30 Tage'
  };
}
