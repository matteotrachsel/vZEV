// ── BKW-TARIFE ────────────────────────────────────────────────────────────────
// Lädt Einheitstarif, Grundtarif und Konzessionsabgabe über /api/tarife (Vercel-
// Funktion, liest https://www.bkw.ch/fileadmin/user_upload/tarife-json.json) und
// setzt die Werte des Jahres ein, in dem die Abrechnungsperiode beginnt.
// Ohne Verbindung (lokal, BKW nicht erreichbar) bleiben die hinterlegten Werte.

const BKW_TARIFF_FALLBACK_YEAR = 2026;   // Jahr der im HTML hinterlegten Werte

const Tariffs = { data: null, error: null, year: null };

async function loadBkwTariffs() {
  try {
    const res = await fetch('/api/tarife', { signal: AbortSignal.timeout(12000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.years) throw new Error(body.error || `HTTP ${res.status}`);
    Tariffs.data = body;
  } catch (e) {
    Tariffs.error = e.name === 'TimeoutError' ? 'Zeitüberschreitung' : e.message;
  }
  applyBkwTariffs(new Date().getFullYear());
}

// Setzt die Tarifwerte für das gewünschte Jahr in die Eingabefelder.
function applyBkwTariffs(year, note = '') {
  const y = Tariffs.data?.years?.[year];
  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v.toFixed(2); };

  if (y && !y.error) {
    set('energyAllIn', y.energyAllInRp);
    set('grundtarif',  y.grundtarifChfY);
    set('konzession',  y.konzessionRp);
    if (typeof syncVzevPrice === 'function') syncVzevPrice();
    Tariffs.year = year;
    setTariffYearLabels(year);

    const p = y.parts, b = p.baseChfMonth;
    const stand = Tariffs.data.lastModified
      ? ` · Stand BKW ${new Date(Tariffs.data.lastModified).toLocaleDateString('de-CH')}` : '';
    setTariffSource('ok',
      `<strong>BKW-Tarife ${year} geladen</strong>${stand}. ` +
      `Einheitstarif = (Energie ${p.energyRp.toFixed(2)} + Netz ${p.gridRp.toFixed(2)} Rp.) × ${(1 + p.vat).toFixed(3)} MWSt.; ` +
      `Grundtarif = (${b.energy} + ${b.grid} + Messung ${b.metering}) CHF/Monat × 12 × ${(1 + p.vat).toFixed(3)}` +
      (p.municipality && p.konzessionRp != null
        ? `; Konzession ${p.municipality} ${p.konzessionRp.toFixed(2)} Rp. × ${(1 + p.vat).toFixed(3)}.` : '.') +
      ' Die Netznutzung enthält bereits Systemdienstleistungen, Stromreserve und die gesetzliche Förderabgabe.' +
      (note ? `<br>${note}` : ''));
    return true;
  }

  // Keine Daten für dieses Jahr → hinterlegte bzw. aktuelle Werte stehen lassen.
  const why = Tariffs.error
    ? `BKW-Tarife konnten nicht geladen werden (${tariffEsc(Tariffs.error)}).`
    : y?.error ? `BKW-Tarife ${year} unvollständig (${tariffEsc(y.error)}).`
    : `BKW hat für ${year} noch keine Tarife publiziert.`;
  const shown = Tariffs.year || BKW_TARIFF_FALLBACK_YEAR;
  setTariffSource('warn', `${why} Es gelten die Werte ${shown} – bitte prüfen.${note ? '<br>' + note : ''}`);
  return false;
}

// Nach dem Daten-Upload: Tarife des Jahres einsetzen, in dem die Periode beginnt.
function applyBkwTariffsForPeriod(rows) {
  if (!rows?.length) return;
  let min = Infinity, max = -Infinity;
  for (const r of rows) { const t = r.datum.getTime(); if (t < min) min = t; if (t > max) max = t; }
  const y1 = new Date(min).getFullYear(), y2 = new Date(max).getFullYear();
  const note = y1 !== y2
    ? `⚠ Die Periode reicht über den Jahreswechsel ${y1}/${y2}. Es werden die Tarife ${y1} verwendet – ` +
      `für eine korrekte Abrechnung die Jahre getrennt auswerten.`
    : '';
  applyBkwTariffs(y1, note);
}

function setTariffYearLabels(year) {
  document.querySelectorAll('.tariff-year').forEach(el => { el.textContent = year; });
}

function setTariffSource(kind, html) {
  const el = document.getElementById('tariffSource');
  if (!el) return;
  el.className = `tariff-source ${kind}`;
  el.innerHTML = html;
}

// Eigener Name: wizard.js deklariert global bereits `esc`.
function tariffEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

document.addEventListener('DOMContentLoaded', loadBkwTariffs);
