// ── PARSER ────────────────────────────────────────────────────────────────────
// Reads XLSX/XLS/CSV files and normalises rows into the internal data format.

// Parses Swiss date strings.
// Handles:  "1.4.2026 00:00:00"  (D.M.YYYY HH:MM:SS)
//           "01.04.2026 00:00"   (DD.MM.YYYY HH:MM)
//           "01.04.2026"         (DD.MM.YYYY – date only)
function parseSwissDate(str) {
  if (!str) return new Date(NaN);
  const s = String(str).trim();
  // With time component
  const mTime = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (mTime) return new Date(+mTime[3], +mTime[2] - 1, +mTime[1], +mTime[4], +mTime[5], 0);
  // Date only
  const mDate = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (mDate) return new Date(+mDate[3], +mDate[2] - 1, +mDate[1], 0, 0, 0);
  return new Date(s); // fallback for ISO strings
}

function readExcel(file) {
  return new Promise((resolve, reject) => {
    const isCSV = /\.csv$/i.test(file.name);

    if (isCSV) {
      // For CSV files, read as UTF-8 text and split manually.
      // This avoids XLSX delimiter auto-detection failures with semicolon-separated files.
      const reader = new FileReader();
      reader.onload = e => {
        try {
          let text = e.target.result;
          // Strip BOM if present
          if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
          const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
          resolve(lines.map(line => line.split(';')));
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsText(file, 'utf-8');
    } else {
      // For Excel files, use SheetJS as before.
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
          const ws  = wb.Sheets[wb.SheetNames[0]];
          resolve(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd hh:mm' }));
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    }
  });
}

function parseRows(rows) {
  if (rows.length < 2) return [];

  const hdr = rows[0].map(h => String(h || '').toLowerCase().trim());
  const cMP = hdr.findIndex(h => h.includes('messpunkt'));
  const cD  = hdr.findIndex(h => h.includes('datum'));
  const cB  = hdr.findIndex(h => h.includes('strombezug') || (h.includes('bezug') && !h.includes('einspeisung')));
  const cE  = hdr.findIndex(h => h.includes('einspeisung'));

  if (cMP < 0 || cD < 0 || cB < 0) {
    throw new Error(
      `Spalten nicht gefunden. Erkannte Spalten: [${hdr.join(' | ')}]. ` +
      `Erwartet: Messpunkt, Datum, Strombezug.`
    );
  }

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[cMP] || !r[cD]) continue;
    const raw = String(r[cD]).trim();
    const d   = r[cD] instanceof Date ? r[cD] : parseSwissDate(raw);
    if (isNaN(d)) continue;
    out.push({
      messpunkt:   String(r[cMP]).trim(),
      datum:       d,
      bezug:       parseFloat(String(r[cB] ?? '').replace(',', '.')) || 0,
      einspeisung: cE >= 0 ? (parseFloat(String(r[cE] ?? '').replace(',', '.')) || 0) : 0
    });
  }
  return out;
}

// Match a raw meter ID against the KNOWN list (handles partial / padded IDs).
function matchMP(raw) {
  for (const m of KNOWN) {
    if (raw === m.messpunktNr || raw.includes(m.messpunktNr) || m.messpunktNr.includes(raw)) {
      return m.messpunktNr;
    }
  }
  return raw;
}

// ── VIRTUELLE vZEV-SUMMENZÄHLPUNKTE ───────────────────────────────────────────
// Netzbetreiber (z. B. BKW) liefern neben den physischen Zählern ein oder zwei
// *virtuelle* Messpunkte mit, die das vZEV-Ergebnis bereits enthalten:
//   – ein Bezugspunkt    mit max(0, ΣVerbrauch − ΣProduktion) je Intervall
//   – ein Einspeisepunkt mit max(0, ΣProduktion − ΣVerbrauch) je Intervall
// Werden sie wie normale Zähler behandelt, zählt der ganze vZEV doppelt.
// Erkennung rein numerisch: ein Kandidat ist virtuell, wenn sich seine Reihe
// nach seinem Entfernen in JEDEM Intervall aus den übrigen Messpunkten ergibt.
function detectVirtualMPs(rows) {
  const slotMap = new Map();  // ts → { messpunkt: row }
  const totals  = new Map();  // messpunkt → { b, e }

  rows.forEach(r => {
    const ts = r.datum.getTime();
    if (!slotMap.has(ts)) slotMap.set(ts, {});
    slotMap.get(ts)[r.messpunkt] = r;
    const t = totals.get(r.messpunkt) || { b: 0, e: 0 };
    t.b += r.bezug;
    t.e += r.einspeisung;
    totals.set(r.messpunkt, t);
  });

  const mps  = [...totals.keys()];
  const draw = mps.filter(m => totals.get(m).b > 0 && totals.get(m).b >= totals.get(m).e);
  const feed = mps.filter(m => totals.get(m).e >  totals.get(m).b);
  // Ein virtueller Punkt kann nur existieren, wenn danach noch je ein
  // physischer Bezugs- und Einspeisepunkt übrig bleibt.
  if (draw.length < 2 && feed.length < 2) return [];

  const slots = [...slotMap.values()];
  const near  = (a, b) => Math.abs(a - b) <= 1e-6 + 1e-9 * Math.abs(b);

  const matches = (vd, vf) => {
    const dd = draw.filter(m => m !== vd);
    const ff = feed.filter(m => m !== vf);
    if (!dd.length || !ff.length) return false;
    return slots.every(s => {
      const c = dd.reduce((x, m) => x + (s[m]?.bezug       || 0), 0);
      const p = ff.reduce((x, m) => x + (s[m]?.einspeisung || 0), 0);
      if (vd && !near(s[vd]?.bezug       || 0, Math.max(0, c - p))) return false;
      if (vf && !near(s[vf]?.einspeisung || 0, Math.max(0, p - c))) return false;
      return true;
    });
  };

  // Breitester Treffer gewinnt: das Paar (Bezug + Einspeisung) vor Einzelpunkten.
  let best = [];
  [...draw, null].forEach(vd => [...feed, null].forEach(vf => {
    if (!vd && !vf) return;
    const cand = [vd, vf].filter(Boolean);
    if (cand.length <= best.length) return;
    if (matches(vd, vf)) best = cand;
  }));
  return best;
}
