// ── UI ────────────────────────────────────────────────────────────────────────
// Handles upload, meter configuration UI, tariff inputs, and wizard steps.
// No inline event handlers – all wired via addEventListener.

document.addEventListener('DOMContentLoaded', () => {
  setupUpload();
  setupStaticHandlers();

  // Auto-recalculate when tariff inputs change (only if data is loaded).
  document.querySelectorAll('#energyPrice,#basePrice,#networkPrice,#levyPrice,#feedInPrice')
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
    const cb = e.target.closest('input[type="checkbox"][id^="prio_"]');
    if (cb) {
      const idx = parseInt(cb.id.replace('prio_', ''), 10);
      updatePrioVisual(idx, cb.checked);
    }
  });
});

function setupStaticHandlers() {
  document.getElementById('calculateBtn').addEventListener('click', calculateAndRender);
  document.getElementById('exportBtn').addEventListener('click', exportCSV);
  document.getElementById('fetchTariffBtn').addEventListener('click', fetchLatestTariff);
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
    <div class="meter-cfg-card${isPrio ? ' is-priority' : ''}" id="card_${i}">
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
      <div id="priorow_${i}" style="${typ !== 'Verbrauch' ? 'display:none' : ''}">
        <label class="prio-toggle${isPrio ? ' active' : ''}" id="priolabel_${i}">
          <input type="checkbox" id="prio_${i}" ${isPrio ? 'checked' : ''}>
          ☀ PV-Priorität: Solarstrom wird zuerst diesem Zähler zugeteilt
        </label>
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
  const prioRow = document.getElementById('priorow_' + idx);
  if (prioRow) prioRow.style.display = sel.value === 'Verbrauch' ? '' : 'none';
}

function updatePrioVisual(idx, checked) {
  document.getElementById('priolabel_' + idx)?.classList.toggle('active', checked);
  document.getElementById('card_' + idx)?.classList.toggle('is-priority', checked);
}

// ── Config readers (used by calculator.js) ────────────────────────────────────

function getMeterConfig() {
  return AppState.detectedMPs.map((mp, i) => ({
    messpunktNr: mp,
    typ:         document.getElementById('typ_' + i)?.value || 'Verbrauch',
    priority:    document.getElementById('typ_' + i)?.value === 'Verbrauch' &&
                 (document.getElementById('prio_' + i)?.checked || false),
    label:       document.getElementById('label_' + i)?.value.trim()   || mp.slice(-8),
    adresse:     document.getElementById('adresse_' + i)?.value.trim() || '',
    zaehlerNr:   document.getElementById('zaehler_' + i)?.value.trim() || ''
  })).filter(m => m.typ !== 'ignore');
}

function getTariff() {
  const ep = parseFloat(document.getElementById('energyPrice').value) / 100;
  const bp = parseFloat(document.getElementById('basePrice').value);
  const np = parseFloat(document.getElementById('networkPrice').value) / 100;
  const lp = parseFloat(document.getElementById('levyPrice').value) / 100;
  const fp = parseFloat(document.getElementById('feedInPrice').value) / 100;
  const splitBase = document.getElementById('splitBase_prop')?.checked || false;
  return { ep, bp, np, lp, fp, work: ep + np + lp, splitBase };
}

// ── BKW tariff fetch ──────────────────────────────────────────────────────────

async function fetchLatestTariff() {
  const btn      = document.getElementById('fetchTariffBtn');
  const statusEl = document.getElementById('tariffFetchStatus');

  btn.disabled    = true;
  btn.textContent = 'Laden…';
  statusEl.innerHTML = '';

  try {
    const res = await fetch('https://www.bkw.ch/de/tarife-json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // Walk the JSON tree to find numeric tariff values.
    // BKW JSON structure: try common key names for energy price (Rp/kWh) and base price (CHF/month).
    let energyPrice = null;
    let basePrice   = null;

    function walk(obj, path) {
      if (!obj || typeof obj !== 'object') return;
      for (const [key, val] of Object.entries(obj)) {
        const k = key.toLowerCase();
        if (typeof val === 'number' && val > 0) {
          if (energyPrice === null && (k.includes('energie') || k.includes('arbeit')) && val < 100) {
            energyPrice = val;
          }
          if (basePrice === null && (k.includes('grund') || k.includes('base') || k.includes('fix')) && val < 50) {
            basePrice = val;
          }
        } else if (typeof val === 'object') {
          walk(val, path + '.' + key);
        }
      }
    }
    walk(data, '');

    let updated = [];
    if (energyPrice !== null) {
      document.getElementById('energyPrice').value = energyPrice.toFixed(2);
      updated.push(`Energiepreis: ${energyPrice.toFixed(2)} Rp/kWh`);
    }
    if (basePrice !== null) {
      document.getElementById('basePrice').value = basePrice.toFixed(2);
      updated.push(`Grundpreis: ${basePrice.toFixed(2)} CHF/Mt.`);
    }

    if (updated.length) {
      statusEl.innerHTML = mkAlert('as', `Tarife aktualisiert – ${updated.join(', ')}`);
      if (AppState.parsedData.length) calculateAndRender();
    } else {
      statusEl.innerHTML = mkAlert('aw',
        'Tarife geladen, aber keine auswertbaren Werte erkannt. Bitte Werte manuell prüfen.'
      );
    }
  } catch (e) {
    statusEl.innerHTML = mkAlert('ae',
      `Tarife konnten nicht geladen werden (${e.message}). Bitte Werte manuell eingeben.`
    );
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Aktuelle Tarife laden';
  }
}
