// ── PARSER ────────────────────────────────────────────────────────────────────
// Reads XLSX/XLS/CSV files and normalises rows into the internal data format.

function readExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd hh:mm' }));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
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
    throw new Error('Spalten Messpunkt, Datum, Strombezug nicht gefunden.');
  }

  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r[cMP] || !r[cD]) continue;
    const d = r[cD] instanceof Date ? r[cD] : new Date(r[cD]);
    if (isNaN(d)) continue;
    out.push({
      messpunkt:   String(r[cMP]).trim(),
      datum:       d,
      bezug:       parseFloat(r[cB]) || 0,
      einspeisung: cE >= 0 ? (parseFloat(r[cE]) || 0) : 0
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
