// ── SWISS QR-BILL ─────────────────────────────────────────────────────────────
// Swiss Payment Standards – Implementation Guidelines QR-bill v2.3.
// Erzeugt den Datensatz (SPC 0200) und zeichnet Empfangsschein + Zahlteil
// (210 × 105 mm) an den unteren Rand einer A4-Seite.
// Seit 22.11.2025 sind nur noch strukturierte Adressen (Typ "S") zulässig.

const QRB = {
  W: 210, H: 105,          // Gesamtformat Zahlteil inkl. Empfangsschein
  RECEIPT_W: 62,           // Breite Empfangsschein
  M: 5,                    // Rand
  QR: 46,                  // Kantenlänge QR-Code
  CROSS: 7,                // Kantenlänge Schweizerkreuz inkl. weissem Rand
  MAX_LEN: 997             // max. Zeichen im Datensatz
};

// ── Zeichensatz ──────────────────────────────────────────────────────────────
// Erlaubt: Basic Latin, Latin-1 Supplement, Latin Extended-A sowie Ș ș Ț ț €.
function qrSanitize(s) {
  return String(s ?? '')
    .replace(/[‐-―]/g, '-')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/…/g, '...')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^ -~ -ſȘ-ț€]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim();
}

// ── IBAN ─────────────────────────────────────────────────────────────────────

function ibanCompact(iban) {
  return String(iban || '').replace(/\s+/g, '').toUpperCase();
}

function ibanFormat(iban) {
  return ibanCompact(iban).replace(/(.{4})/g, '$1 ').trim();
}

// mod 97 über eine beliebig lange Ziffernfolge (ohne BigInt).
function mod97(digits) {
  let r = 0;
  for (let i = 0; i < digits.length; i += 7) r = parseInt(String(r) + digits.slice(i, i + 7), 10) % 97;
  return r;
}

const alnumToDigits = s => s.replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));

// Für QR-Rechnungen sind nur CH- und LI-IBAN (21 Stellen) zulässig.
function ibanValid(iban) {
  const c = ibanCompact(iban);
  if (!/^(CH|LI)\d{2}[0-9A-Z]{17}$/.test(c)) return false;
  return mod97(alnumToDigits(c.slice(4) + c.slice(0, 4))) === 1;
}

// QR-IID (Stelle 5–9) im Bereich 30000–31999 → QR-IBAN, verlangt QR-Referenz.
function isQrIban(iban) {
  const iid = parseInt(ibanCompact(iban).slice(4, 9), 10);
  return iid >= 30000 && iid <= 31999;
}

// ── Referenzen ───────────────────────────────────────────────────────────────

// QR-Referenz: 26 Ziffern + Prüfziffer (Modulo 10 rekursiv).
function qrrReference(seed) {
  const body  = String(seed).replace(/\D/g, '').slice(-26).padStart(26, '0');
  const table = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let carry = 0;
  for (const d of body) carry = table[(carry + +d) % 10];
  return body + ((10 - carry) % 10);
}

// Creditor Reference nach ISO 11649: "RF" + 2 Prüfziffern + max. 21 Zeichen.
function scorReference(seed) {
  const body  = String(seed).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(-21) || '0';
  const check = 98 - mod97(alnumToDigits(body + 'RF00'));
  return 'RF' + String(check).padStart(2, '0') + body;
}

function referenceFormat(type, ref) {
  if (type === 'QRR') return ref.replace(/^(\d{2})(\d{5})(\d{5})(\d{5})(\d{5})(\d{5})$/, '$1 $2 $3 $4 $5 $6');
  if (type === 'SCOR') return ref.replace(/(.{4})/g, '$1 ').trim();
  return ref;
}

// Betrag für die Anzeige: Tausender mit Leerschlag, Dezimalpunkt.
function qrAmountFormat(v) {
  const [i, d] = v.toFixed(2).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + '.' + d;
}

// ── Datensatz ────────────────────────────────────────────────────────────────
// bill = { iban, creditor, debtor|null, amount|null, currency, refType, reference, message }
// Adressen: { name, street, houseNo, zip, town, country }
function addressComplete(a) {
  return !!(a && a.name && a.zip && a.town && a.country);
}

function buildQrPayload(bill) {
  const adr = a => addressComplete(a)
    ? ['S', a.name, a.street || '', a.houseNo || '', a.zip, a.town, a.country.toUpperCase()].map(qrSanitize)
    : ['', '', '', '', '', '', ''];
  const lines = [
    'SPC', '0200', '1',
    ibanCompact(bill.iban),
    ...adr(bill.creditor),
    '', '', '', '', '', '', '',                       // Ultimate Creditor (reserviert)
    bill.amount != null ? bill.amount.toFixed(2) : '',
    bill.currency || 'CHF',
    ...adr(bill.debtor),
    bill.refType,
    bill.refType === 'NON' ? '' : bill.reference,
    qrSanitize(bill.message).slice(0, 140),
    'EPD'
  ];
  return lines.join('\n');
}

// Prüft den Datensatz auf die Regeln, die in der Praxis am häufigsten scheitern.
function validateBill(bill) {
  const err = [];
  if (!ibanValid(bill.iban)) err.push('IBAN ungültig (nur CH/LI zulässig).');
  if (!addressComplete(bill.creditor)) err.push('Adresse Rechnungssteller unvollständig.');
  const c = bill.creditor || {};
  if ((c.name || '').length > 70)  err.push('Name Rechnungssteller > 70 Zeichen.');
  if ((c.town || '').length > 35)  err.push('Ort Rechnungssteller > 35 Zeichen.');
  if (bill.amount != null && !(bill.amount >= 0.01 && bill.amount <= 999999999.99)) err.push('Betrag ausserhalb 0.01–999 999 999.99.');
  const qr = isQrIban(bill.iban);
  if (qr && bill.refType !== 'QRR') err.push('QR-IBAN verlangt eine QR-Referenz.');
  if (!qr && bill.refType === 'QRR') err.push('QR-Referenz nur mit QR-IBAN zulässig.');
  if (buildQrPayload(bill).length > QRB.MAX_LEN) err.push('QR-Datensatz zu lang.');
  return err;
}

// ── Zeichnen ─────────────────────────────────────────────────────────────────

function qrMatrix(text) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  const qr = qrcode(0, 'M');   // Version automatisch, Fehlerkorrektur M (Pflicht)
  qr.addData(text, 'Byte');
  qr.make();
  return qr;
}

function drawSwissCross(doc, cx, cy) {
  const s = QRB.CROSS, inner = s - 2 * 0.5;
  doc.setFillColor(255, 255, 255);
  doc.rect(cx - s / 2, cy - s / 2, s, s, 'F');
  doc.setFillColor(0, 0, 0);
  doc.rect(cx - inner / 2, cy - inner / 2, inner, inner, 'F');
  // Proportionen der Schweizer Flagge: Kreuzarm 6/32, Kreuzlänge 20/32.
  const len = inner * 20 / 32, w = inner * 6 / 32;
  doc.setFillColor(255, 255, 255);
  doc.rect(cx - w / 2,   cy - len / 2, w,   len, 'F');
  doc.rect(cx - len / 2, cy - w / 2,   len, w,   'F');
}

function drawQrCode(doc, text, x, y) {
  const qr = qrMatrix(text);
  const n  = qr.getModuleCount();
  const m  = QRB.QR / n;
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) {
    // Benachbarte dunkle Module einer Zeile zu einem Rechteck zusammenfassen.
    let c = 0;
    while (c < n) {
      if (!qr.isDark(r, c)) { c++; continue; }
      const start = c;
      while (c < n && qr.isDark(r, c)) c++;
      doc.rect(x + start * m, y + r * m, (c - start) * m + 0.01, m + 0.01, 'F');
    }
  }
  drawSwissCross(doc, x + QRB.QR / 2, y + QRB.QR / 2);
}

// Eckmarken für ein leeres Feld (Betrag bzw. "Zahlbar durch" ohne Adresse).
function drawCornerMarks(doc, x, y, w, h) {
  const l = 3;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]].forEach(([cx, cy, dx, dy]) => {
    doc.line(cx, cy, cx + dx * l, cy);
    doc.line(cx, cy, cx, cy + dy * l);
  });
}

const ptToMm = pt => pt * 25.4 / 72;

function addressLines(a) {
  return [
    a.name,
    [a.street, a.houseNo].filter(Boolean).join(' '),
    `${a.country && a.country.toUpperCase() !== 'CH' ? a.country.toUpperCase() + '-' : ''}${a.zip} ${a.town}`
  ].filter(s => s && s.trim());
}

// Zeichnet Empfangsschein + Zahlteil ab y0 (A4: 297 − 105 = 192).
function drawQRBill(doc, bill, y0 = 297 - QRB.H) {
  const { M, RECEIPT_W } = QRB;
  const payload = buildQrPayload(bill);
  const hasDebtor = addressComplete(bill.debtor);
  const refType   = bill.refType;
  const refStr    = refType === 'NON' ? '' : referenceFormat(refType, bill.reference);
  const creditor  = [ibanFormat(bill.iban), ...addressLines(bill.creditor)];
  const debtor    = hasDebtor ? addressLines(bill.debtor) : null;
  const amountStr = bill.amount != null ? qrAmountFormat(bill.amount) : '';

  // ── Trennlinien ────────────────────────────────────────────────────────────
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(0, y0, QRB.W, y0);
  doc.line(RECEIPT_W, y0, RECEIPT_W, y0 + QRB.H);
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.text('Vor der Einzahlung abzutrennen', QRB.W / 2, y0 - 1.5, { align: 'center' });

  // Schreibhilfe: gibt die nächste y-Position zurück.
  const block = (x, y, heading, lines, hPt, vPt, gapPt) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(hPt);
    doc.text(heading, x, y);
    y += ptToMm(vPt + 1);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(vPt);
    lines.forEach(l => { doc.text(l, x, y); y += ptToMm(vPt + 1); });
    return y + ptToMm(gapPt);
  };

  // ── Empfangsschein ─────────────────────────────────────────────────────────
  let x = M, y = y0 + M + ptToMm(11);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Empfangsschein', x, y);
  y += ptToMm(11) + 2;
  const rw = RECEIPT_W - 2 * M;
  y = block(x, y, 'Konto / Zahlbar an', creditor.flatMap(l => doc.splitTextToSize(l, rw)), 6, 8, 4);
  if (refStr) y = block(x, y, 'Referenz', [refStr], 6, 8, 4);
  if (debtor) {
    y = block(x, y, 'Zahlbar durch', debtor.flatMap(l => doc.splitTextToSize(l, rw)), 6, 8, 4);
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
    doc.text('Zahlbar durch (Name/Adresse)', x, y);
    drawCornerMarks(doc, x, y + 1, 52, 20);
  }

  // Betrag
  let ay = y0 + 68;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
  doc.text('Währung', x, ay);
  doc.text('Betrag', x + 12, ay);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(bill.currency || 'CHF', x, ay + ptToMm(9));
  if (amountStr) doc.text(amountStr, x + 12, ay + ptToMm(9));
  else drawCornerMarks(doc, x + 22, ay - 1, 30, 10);

  // Annahmestelle
  doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
  doc.text('Annahmestelle', RECEIPT_W - M, y0 + 82, { align: 'right' });

  // ── Zahlteil ───────────────────────────────────────────────────────────────
  x = RECEIPT_W + M;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('Zahlteil', x, y0 + M + ptToMm(11));

  drawQrCode(doc, payload, x, y0 + 17);

  ay = y0 + 68;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('Währung', x, ay);
  doc.text('Betrag', x + 14, ay);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(bill.currency || 'CHF', x, ay + ptToMm(11));
  if (amountStr) doc.text(amountStr, x + 14, ay + ptToMm(11));
  else drawCornerMarks(doc, x + 11, ay + 2, 40, 15);

  // Angaben (rechte Spalte)
  const ix = RECEIPT_W + M + QRB.QR + M;     // 118 mm
  const iw = QRB.W - M - ix;
  y = y0 + M + ptToMm(8);
  y = block(ix, y, 'Konto / Zahlbar an', creditor.flatMap(l => doc.splitTextToSize(l, iw)), 8, 10, 5);
  if (refStr) y = block(ix, y, 'Referenz', [refStr], 8, 10, 5);
  const msg = qrSanitize(bill.message);
  if (msg) y = block(ix, y, 'Zusätzliche Informationen', doc.splitTextToSize(msg, iw), 8, 10, 5);
  if (debtor) {
    block(ix, y, 'Zahlbar durch', debtor.flatMap(l => doc.splitTextToSize(l, iw)), 8, 10, 0);
  } else {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    doc.text('Zahlbar durch (Name/Adresse)', ix, y);
    drawCornerMarks(doc, ix, y + 1.5, 65, 25);
  }
  return payload;
}
