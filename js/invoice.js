// ── INVOICE (PDF) ─────────────────────────────────────────────────────────────
// Erzeugt pro Teilnehmer (Verbrauchs-Messpunkt) eine eigene A4-Rechnung:
//   Seite 1 – Brief mit Fakturierung und Swiss QR-Zahlteil
//   Seite 2 – Messwerte pro Monat (Verbrauch, Solaranteil, Netzbezug)
// Die Erfassung von Absender und Empfängern läuft über den Wizard (wizard.js).

const INV = {
  ML: 20, MR: 190,
  BLACK:  [0,   0,   0  ],
  DGRAY:  [50,  50,  50 ],
  GRAY:   [110, 110, 110],
  LGRAY:  [170, 170, 170],
  BORDER: [195, 195, 195],
  BLUE:   [0,   70,  176],
  NAVY:   [11,  34,  71 ],
  GREEN:  [58,  170, 106],
  CONTENT_END: 184           // darunter beginnt der QR-Zahlteil (y = 192)
};

const round2 = v => Math.round(v * 100) / 100;
const round1 = v => Math.round(v * 10) / 10;
const fmtKwh = v => `${v.toLocaleString('de-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`;

// ── Daten pro Teilnehmer ──────────────────────────────────────────────────────
// Mengen werden auf 0.1 kWh, Beträge pro Zeile auf Rappen gerundet und das
// Total aus den gerundeten Zeilen gebildet – so ist jede Zeile nachrechenbar.
function invoiceParticipants(result) {
  const { agg, meters, tariff } = result;
  const mc = getMonthCount();

  return meters.filter(m => m.typ === 'Verbrauch').map(m => {
    const months = Object.keys(agg[m.messpunktNr] || {}).sort();
    const rows   = months.map(mk => ({ mk, ...agg[m.messpunktNr][mk] }));
    const sum    = k => rows.reduce((s, r) => s + (r[k] || 0), 0);

    const cons = sum('cons'), grid = round1(sum('grid'));
    const own  = round1(sum('own'));
    const pool = round1(sum('vzev') - sum('own'));

    const lines = [];
    const add = (label, qty, unit, price, amount) => lines.push({ label, qty, unit, price, amount: round2(amount) });
    add('Grundtarif', `${mc} ${mc === 1 ? 'Monat' : 'Monate'}`, '', `${(tariff.grundtarif * 12).toFixed(2)} CHF/Jahr`, mc * tariff.grundtarif);
    add('Energie Einheitstarif (Netzbezug)', fmtKwh(grid), 'kWh', `${(tariff.energyAllIn * 100).toFixed(2)} Rp./kWh`, grid * tariff.energyAllIn);
    if (own >= 0.05) add('Eigenverbrauch eigene PV-Anlage', fmtKwh(own), 'kWh', `${(tariff.vzevPrice * 100).toFixed(2)} Rp./kWh`, own * tariff.vzevPrice);
    // Beim Produzenten ohne Bezug aus dem Pool keine Nullzeile ausweisen.
    if (pool >= 0.05 || own < 0.05) add('Solarstrom vom vZEV', fmtKwh(pool), 'kWh', `${(tariff.vzevPrice * 100).toFixed(2)} Rp./kWh`, pool * tariff.vzevPrice);
    add('Konzessionsabgabe Gemeinde (auf Netzbezug)', fmtKwh(grid), 'kWh', `${(tariff.konzession * 100).toFixed(2)} Rp./kWh`, grid * tariff.konzession);

    const total = round2(lines.reduce((s, l) => s + l.amount, 0));
    return { m, rows, cons, grid, own, pool, lines, total };
  });
}

// ── Logo ──────────────────────────────────────────────────────────────────────
// Eigenes Logo (Bild) oder die Wortmarke der App: blaues Dach-Signet mit
// grünem Sonnenpunkt, daneben "vZEV" und der Name des Zusammenschlusses.
function drawLogo(doc, sender, logo) {
  const { MR, NAVY, BLUE, GREEN, GRAY } = INV;
  const top = 12;

  if (logo?.dataUrl) {
    const maxW = 55, maxH = 18;
    const s = Math.min(maxW / logo.w, maxH / logo.h);
    const w = logo.w * s, h = logo.h * s;
    doc.addImage(logo.dataUrl, logo.format || 'PNG', MR - w, top, w, h, 'logo', 'FAST');
    return top + h;
  }

  const name = sender.name || 'vZEV Zusammenschluss';
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  const wordW = doc.getTextWidth('vZEV');
  // Name auf max. 58 mm einpassen.
  let nameSize = 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(nameSize);
  while (doc.getTextWidth(name) > 58 && nameSize > 5.5) { nameSize -= 0.25; doc.setFontSize(nameSize); }
  const nameW = Math.min(doc.getTextWidth(name), 58);

  const mark = 13, gap = 3;
  const textW = Math.max(wordW, nameW);
  const x0 = MR - textW - gap - mark;

  // Signet – Proportionen wie das 34-px-SVG im App-Header.
  const k = mark / 34;
  doc.setFillColor(...BLUE);
  doc.roundedRect(x0, top, mark, mark, 1.6, 1.6, 'F');
  doc.setFillColor(255, 255, 255);
  doc.triangle(x0 + 8 * k, top + 25 * k, x0 + 17 * k, top + 9 * k, x0 + 26 * k, top + 25 * k, 'F');
  doc.setFillColor(...BLUE);
  doc.triangle(x0 + 13 * k, top + 25 * k, x0 + 17 * k, top + 18 * k, x0 + 21 * k, top + 25 * k, 'F');
  doc.setFillColor(...GREEN);
  doc.circle(x0 + 26.5 * k, top + 8 * k, 2.6 * k, 'F');

  const tx = x0 + mark + gap;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...NAVY);
  doc.text('vZEV', tx, top + 6.6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(nameSize);
  doc.setTextColor(...GRAY);
  doc.text(doc.splitTextToSize(name, 58)[0], tx, top + 11.6);
  return top + mark;
}

// ── Seite 1: Brief + Fakturierung + QR-Zahlteil ───────────────────────────────

function drawInvoicePage(doc, p, ctx) {
  const { ML, MR, BLACK, DGRAY, GRAY, LGRAY, BORDER } = INV;
  const { sender, recipient, logo, invNr, invDate, dueDate, periodStart, periodEnd, bill } = ctx;

  // Absender (rechts oben)
  let sy = drawLogo(doc, sender, logo) + 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  [
    [sender.street, sender.houseNo].filter(Boolean).join(' '),
    [sender.zip, sender.town].filter(Boolean).join(' '),
    sender.contact
  ].filter(Boolean).forEach(l => { doc.text(l, MR, sy, { align: 'right' }); sy += 3.8; });

  // Absenderzeile + Empfänger (Fenster links)
  doc.setFontSize(6.5);
  doc.setTextColor(...LGRAY);
  doc.text([sender.name, [sender.street, sender.houseNo].filter(Boolean).join(' '), [sender.zip, sender.town].filter(Boolean).join(' ')]
    .filter(Boolean).join(', '), ML, 49);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.2);
  doc.line(ML, 50.3, ML + 85, 50.3);

  let ry = 56;
  doc.setFontSize(10);
  doc.setTextColor(...BLACK);
  addressLinesLetter(recipient).forEach(l => { doc.text(l, ML, ry); ry += 4.8; });

  // Rechnungsangaben (rechte Spalte)
  const kx = 112, vx = 140;
  let my = 56;
  const meta = [
    ['Rechnungsdatum', fmt(invDate)],
    ['Rechnungs-Nr.',  invNr],
    ['Zahlbar bis',    fmt(dueDate)],
    ['Bezugsstelle',   p.m.label || '–'],
    ['Zählernummer',   p.m.zaehlerNr || '–'],
    ['Messpunkt',      p.m.messpunktNr]
  ];
  meta.forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...DGRAY);
    doc.text(k, kx, my);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...BLACK);
    doc.setFontSize(k === 'Messpunkt' ? 6.8 : 7.5);
    doc.text(String(v), vx, my);
    my += 4.3;
  });

  // Titel
  let y = 94;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...BLACK);
  doc.text('Stromrechnung', ML, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  doc.text(`Bezugszeitraum ${fmt(periodStart)} – ${fmt(periodEnd)}  ·  Produkt: Energy Blue – Einheitstarif`, ML, y + 5.5);

  // Fakturierung
  y += 13;
  const cQ = 122, cP = 158;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('Position', ML, y);
  doc.text('Menge',    cQ, y, { align: 'right' });
  doc.text('Preis',    cP, y, { align: 'right' });
  doc.text('Betrag CHF', MR, y, { align: 'right' });
  y += 1.8;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(ML, y, MR, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...BLACK);
  p.lines.forEach(l => {
    doc.text(l.label, ML, y);
    doc.text(l.qty,   cQ, y, { align: 'right' });
    doc.text(l.price, cP, y, { align: 'right' });
    doc.text(fmtCHF(l.amount), MR, y, { align: 'right' });
    y += 5.6;
  });

  y += 0.5;
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(ML, y, MR, y);
  y += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('Zu bezahlender Betrag (inkl. MWSt.)', ML, y);
  doc.text(`CHF ${fmtCHF(p.total)}`, MR, y, { align: 'right' });
  doc.setLineWidth(0.6);
  doc.line(ML, y + 2.8, MR, y + 2.8);
  y += 10;

  // Hinweise
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...DGRAY);
  const note = bill
    ? `Bitte begleichen Sie den Betrag bis ${fmt(dueDate)} mit dem untenstehenden QR-Zahlteil. Die Messwerte pro Monat finden Sie auf Seite 2.`
    : `Bitte überweisen Sie den Betrag bis ${fmt(dueDate)}. Die Messwerte pro Monat finden Sie auf Seite 2.`;
  doc.splitTextToSize(note, MR - ML).forEach(l => { doc.text(l, ML, y); y += 4; });
  y += 3;
  doc.setTextColor(...BLACK);
  if (y + 4 < INV.CONTENT_END) { doc.text('Freundliche Grüsse', ML, y); y += 4.2; }
  if (y < INV.CONTENT_END)     { doc.text(sender.name || 'vZEV Zusammenschluss', ML, y); }

  if (bill) drawQRBill(doc, bill);
  else      drawFooter(doc, ctx, 1);
}

function addressLinesLetter(a) {
  return [
    a.name,
    a.extra,
    [a.street, a.houseNo].filter(Boolean).join(' '),
    `${a.country && a.country.toUpperCase() !== 'CH' ? a.country.toUpperCase() + '-' : ''}${[a.zip, a.town].filter(Boolean).join(' ')}`
  ].filter(s => s && s.trim());
}

// ── Seite 2: Messwerte ────────────────────────────────────────────────────────

function drawDetailsPage(doc, p, ctx) {
  const { ML, MR, BLACK, DGRAY, GRAY, BORDER } = INV;
  const { invNr, periodStart, periodEnd } = ctx;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...BLACK);
  doc.text('Messwerte und Energieherkunft', ML, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(`Rechnungs-Nr. ${invNr}`, MR, 18, { align: 'right' });
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(ML, 21, MR, 21);

  let y = 29;
  [
    ['Bezugsstelle', [p.m.label, p.m.adresse].filter(Boolean).join(', ')],
    ['Messpunkt',    p.m.messpunktNr],
    ['Zählernummer', p.m.zaehlerNr || '–'],
    ['Zeitraum',     `${fmt(periodStart)} – ${fmt(periodEnd)}`]
  ].forEach(([k, v]) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...BLACK);
    doc.text(k, ML, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DGRAY);
    doc.text(String(v), ML + 28, y);
    y += 4.6;
  });

  // Tabelle
  y += 5;
  const hasOwn = p.own >= 0.05;
  const cols = hasOwn
    ? [['Monat', ML, 'left'], ['Verbrauch', 104, 'right'], ['Eigene PV', 128, 'right'], ['Solar vZEV', 152, 'right'], ['Netzbezug', MR, 'right']]
    : [['Monat', ML, 'left'], ['Verbrauch', 122, 'right'], ['Solar vZEV', 156, 'right'], ['Netzbezug', MR, 'right']];

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  cols.forEach(([t, x, a]) => doc.text(t, x, y, { align: a }));
  y += 1.8;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(ML, y, MR, y);
  y += 5;

  const rowVals = r => hasOwn
    ? [r.cons, r.own || 0, (r.vzev || 0) - (r.own || 0), r.grid]
    : [r.cons, r.vzev || 0, r.grid];

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...BLACK);
  p.rows.forEach(r => {
    const [yr, mo] = r.mk.split('-').map(Number);
    const label = new Date(yr, mo - 1, 1).toLocaleDateString('de-CH', { month: 'long', year: 'numeric' });
    doc.text(label, ML, y);
    rowVals(r).forEach((v, i) => doc.text(fmtKwh(v), cols[i + 1][1], y, { align: 'right' }));
    y += 5.4;
  });

  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.4);
  doc.line(ML, y - 1.5, MR, y - 1.5);
  y += 3.5;
  doc.setFont('helvetica', 'bold');
  doc.text('Total', ML, y);
  const totRow = { cons: p.cons, own: p.own, vzev: p.own + p.pool, grid: p.grid };
  rowVals(totRow).forEach((v, i) => doc.text(fmtKwh(v), cols[i + 1][1], y, { align: 'right' }));

  // Anteil Solarstrom als Balken
  y += 12;
  const solar = p.own + p.pool;
  const share = p.cons > 0 ? solar / p.cons : 0;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Herkunft Ihres Stroms', ML, y);
  y += 4;
  const bw = MR - ML;
  doc.setFillColor(...INV.BLUE);
  doc.rect(ML, y, bw, 4, 'F');
  if (share > 0) {
    doc.setFillColor(...INV.GREEN);
    doc.rect(ML, y, bw * share, 4, 'F');
  }
  y += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setFillColor(...INV.GREEN); doc.rect(ML, y - 2.6, 3, 3, 'F');
  doc.setTextColor(...BLACK);
  doc.text(`Solarstrom ${(share * 100).toFixed(1)} %`, ML + 5, y);
  doc.setFillColor(...INV.BLUE); doc.rect(ML + 50, y - 2.6, 3, 3, 'F');
  doc.text(`Netzbezug ${((1 - share) * 100).toFixed(1)} %`, ML + 55, y);

  // Methode
  y += 12;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('So wird der Solarstrom verteilt', ML, y);
  y += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...DGRAY);
  const txt =
    'Grundlage sind die 15-Minuten-Messwerte des Netzbetreibers. In jedem Intervall deckt die PV-Anlage zuerst ' +
    'den Verbrauch am eigenen Anschluss (Eigenverbrauch). Der verbleibende Solarstrom wird im Verhältnis zum ' +
    'Verbrauch auf alle Teilnehmenden des Zusammenschlusses verteilt. Was nicht durch Solarstrom gedeckt ist, ' +
    'wird als Netzbezug zum Einheitstarif verrechnet; die Konzessionsabgabe fällt nur auf den Netzbezug an.';
  doc.splitTextToSize(txt, MR - ML).forEach(l => { doc.text(l, ML, y); y += 4; });

  drawFooter(doc, ctx, 2);
}

function drawFooter(doc, ctx, page) {
  const { ML, MR, LGRAY } = INV;
  const { sender, invNr } = ctx;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...LGRAY);
  doc.text([sender.name, sender.contact, sender.iban ? `IBAN ${ibanFormat(sender.iban)}` : ''].filter(Boolean).join('  ·  '), ML, 287);
  doc.text(`${invNr}  ·  Seite ${page}/2`, MR, 287, { align: 'right' });
}

// ── Öffentliche API ───────────────────────────────────────────────────────────
// ctx = { sender, recipient, logo, invNr, invDate, dueDate, periodStart, periodEnd, refType, reference }
function buildInvoiceDoc(p, ctx) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Stromrechnung ${ctx.invNr}`, subject: `vZEV ${p.m.label}`, creator: 'vZEV Stromauswertung' });

  const bill = invoiceBill(p, ctx);
  drawInvoicePage(doc, p, { ...ctx, bill });
  doc.addPage();
  drawDetailsPage(doc, p, ctx);
  return doc;
}

// QR-Zahlteil nur bei gültiger IBAN und positivem Betrag.
function invoiceBill(p, ctx) {
  const { sender, recipient } = ctx;
  if (!ibanValid(sender.iban) || p.total < 0.01) return null;
  return {
    iban:      sender.iban,
    creditor:  { name: sender.name, street: sender.street, houseNo: sender.houseNo, zip: sender.zip, town: sender.town, country: sender.country || 'CH' },
    debtor:    { name: recipient.name, street: recipient.street, houseNo: recipient.houseNo, zip: recipient.zip, town: recipient.town, country: recipient.country || 'CH' },
    amount:    p.total,
    currency:  'CHF',
    refType:   ctx.refType,
    reference: ctx.reference,
    message:   `Stromrechnung ${ctx.invNr}, ${fmt(ctx.periodStart)}-${fmt(ctx.periodEnd)}`
  };
}

// Referenz aus der Rechnungsnummer: QR-IBAN → QR-Referenz, sonst Creditor Reference.
function invoiceReference(iban, invNr) {
  if (!ibanValid(iban)) return { refType: 'NON', reference: '' };
  return isQrIban(iban)
    ? { refType: 'QRR',  reference: qrrReference(invNr) }
    : { refType: 'SCOR', reference: scorReference(invNr) };
}
