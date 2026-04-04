// ── INVOICE (PDF) ─────────────────────────────────────────────────────────────
// Generates a BKW-style A4 PDF invoice (cover page + one detail page per meter).

function exportPDF() {
  const result = AppState.lastResult;
  if (!result) { alert('Bitte zuerst eine Auswertung erstellen.'); return; }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const { agg, monthly, tot, scRate, ssRate, meters, tariff, periodStart, periodEnd } = result;
  const cM     = meters.filter(m => m.typ === 'Verbrauch');
  const mc     = getMonthCount();
  const header = getInvoiceHeader();

  const today      = new Date();
  const dateStr    = fmt(today);
  const dueDate    = new Date(today); dueDate.setDate(dueDate.getDate() + 30);
  const dueDateStr = fmt(dueDate);
  const invNr      = `vZEV-${today.getFullYear()}${String(today.getMonth()+1).padStart(2,'0')}${String(today.getDate()).padStart(2,'0')}-001`;

  // Pre-compute per-meter totals
  const meterData = cM.map(m => {
    let g = 0, v = 0, cons = 0, fiKwh = 0;
    Object.values(agg[m.messpunktNr] || {}).forEach(d => {
      g    += d.grid;
      v    += d.vzev;
      cons += d.cons;
      fiKwh += (d.fi || 0);
    });
    const grundtarifTotal = mc * tariff.grundtarif;
    const pvshareTotal    = mc * tariff.pvshareAbo;
    const eb     = g    * tariff.energyAllIn;
    const vz     = v    * tariff.vzevPrice;
    const fiAmt  = fiKwh * tariff.feedIn;
    const subtotal = grundtarifTotal + pvshareTotal + eb + vz;
    const total    = subtotal - fiAmt;
    return { m, g, v, cons, fiKwh, eb, vz, grundtarifTotal, pvshareTotal, fiAmt, subtotal, total };
  });

  const totalPages = meterData.length + 1;

  // Page 1: Cover / Summary
  drawCoverPage(doc, { header, dateStr, dueDateStr, periodStr: `${fmt(periodStart)} – ${fmt(periodEnd)}`,
    invNr, meterData, periodStart, periodEnd, totalPages });

  // Pages 2+: Detail per meter
  meterData.forEach((md, idx) => {
    doc.addPage();
    drawDetailPage(doc, { ...md, tariff, mc, agg, periodStart, periodEnd, invNr, header, pageNum: idx + 2, totalPages });
  });

  doc.save(`vZEV_Rechnung_${today.toISOString().slice(0,10)}.pdf`);
}

// ── Shared style constants ────────────────────────────────────────────────────

const INV = {
  ML: 20, MR: 190,
  BLACK:  [0,   0,   0  ],
  DGRAY:  [50,  50,  50 ],
  GRAY:   [110, 110, 110],
  LGRAY:  [170, 170, 170],
  BORDER: [195, 195, 195],
};

// ── Cover Page ────────────────────────────────────────────────────────────────

function drawCoverPage(doc, { header, dateStr, dueDateStr, periodStr, invNr, meterData, periodStart, periodEnd, totalPages }) {
  const { ML, MR, BLACK, DGRAY, GRAY, LGRAY, BORDER } = INV;
  const hdr  = header || {};
  const name = hdr.name || 'vZEV Ogimatte';

  // ── Logo box (top right) ──────────────────────────────────────────────────
  doc.setFillColor(30, 30, 30);
  doc.roundedRect(MR - 36, 10, 36, 14, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(name, MR - 18, 18.5, { align: 'center' });

  // ── Sender address (right, below logo) ───────────────────────────────────
  let sy = 30;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BLACK);
  doc.text(name, MR, sy, { align: 'right' }); sy += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  if (hdr.street)  { doc.text(hdr.street,  MR, sy, { align: 'right' }); sy += 4; }
  if (hdr.city)    { doc.text(hdr.city,    MR, sy, { align: 'right' }); sy += 5; }
  if (hdr.contact) { doc.text(hdr.contact, MR, sy, { align: 'right' }); sy += 4; }
  sy += 2;
  if (hdr.iban) { doc.text(`IBAN: ${hdr.iban}`, MR, sy, { align: 'right' }); sy += 4; }

  // ── Recipient address (left window area) ─────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...LGRAY);
  doc.text([name, hdr.city].filter(Boolean).join(', '), ML, 46);

  const firstM = meterData[0]?.m;
  let ry = 54;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...BLACK);
  if (firstM?.label)   { doc.text(firstM.label,   ML, ry); ry += 5.5; }
  if (firstM?.adresse) {
    doc.setFontSize(9);
    doc.setTextColor(...DGRAY);
    const adressLines = doc.splitTextToSize(firstM.adresse, 80);
    adressLines.forEach(l => { doc.text(l, ML, ry); ry += 4.5; });
  }

  // ── Meta info block ───────────────────────────────────────────────────────
  const metaY = 80;
  doc.setFillColor(...BLACK);
  doc.rect(ML, metaY, 1, 13, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BLACK);
  doc.text(`Rechnungsdatum: ${dateStr}`, ML + 4, metaY + 5);
  doc.text(`Zahlbar bis: ${dueDateStr}`,  ML + 4, metaY + 10.5);

  const mx = ML + 95;
  const metaLabels = ['Bezugsstelle:', 'Produkt/Tarif:', 'Messpunkt:', 'Zählernummer:'];
  metaLabels.forEach((lbl, i) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...BLACK);
    doc.text(lbl, mx, metaY + 2 + i * 4);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text('Siehe Details', mx + 30, metaY + 2 + i * 4);
  });

  // ── "Rechnung" heading ────────────────────────────────────────────────────
  const rechY = 108;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(20);
  doc.setTextColor(...BLACK);
  doc.text('Rechnung', ML, rechY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRAY);
  doc.text(`für den Bezugszeitraum vom ${fmt(periodStart)} bis ${fmt(periodEnd)}`, ML, rechY + 6);

  // ── Summary table ─────────────────────────────────────────────────────────
  let ty = rechY + 14;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.4);
  doc.line(ML, ty, MR, ty);

  // Column label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('Betrag', MR, ty - 1.5, { align: 'right' });
  ty += 6;

  // One line per meter
  const grandTotal = meterData.reduce((s, d) => s + d.total, 0);
  meterData.forEach(({ m, total }) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...BLACK);
    doc.text(`${m.label || m.messpunktNr} gemäss Details`, ML, ty);
    doc.text('CHF', MR - 30, ty);
    doc.text(fmtCHF(total), MR, ty, { align: 'right' });
    ty += 7;
  });

  // Divider + Gesamtbetrag
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.35);
  doc.line(ML, ty, MR, ty); ty += 6;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...BLACK);
  doc.text('Gesamtbetrag (gemäss Detailseiten)', ML, ty);
  doc.text('CHF', MR - 30, ty);
  doc.text(fmtCHF(grandTotal), MR, ty, { align: 'right' });
  ty += 7;

  // Zu bezahlender Betrag
  doc.setDrawColor(...BORDER);
  doc.line(ML, ty - 2, MR, ty - 2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  doc.text('Zu bezahlender Betrag', ML, ty + 4);
  doc.text('CHF', MR - 30, ty + 4);
  doc.text(fmtCHF(grandTotal), MR, ty + 4, { align: 'right' });
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.6);
  doc.line(ML, ty + 7, MR, ty + 7);

  // ── Footer text ───────────────────────────────────────────────────────────
  ty += 20;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...BLACK);
  doc.text('Freundliche Grüsse', ML, ty); ty += 5;
  doc.text(name, ML, ty); ty += 10;
  if (hdr.iban) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRAY);
    doc.text(`IBAN: ${hdr.iban}    ·    Zahlbar bis: ${dueDateStr}`, ML, ty);
  }

  // ── Page number ───────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...LGRAY);
  doc.text(`Seite 1/${totalPages}`, MR, 285, { align: 'right' });
}

// ── Detail Page ───────────────────────────────────────────────────────────────

function drawDetailPage(doc, { m, g, v, cons, fiKwh, eb, vz, grundtarifTotal, pvshareTotal, fiAmt, subtotal, total, tariff, mc, agg, periodStart, periodEnd, invNr, header, pageNum, totalPages }) {
  const { ML, MR, BLACK, DGRAY, GRAY, LGRAY, BORDER } = INV;
  const hdr = header || {};

  // ── Detail header bar ─────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  doc.text('Details Ihrer Rechnung', ML, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...GRAY);
  doc.text(`Rechnungs-Nr.     ${invNr}`, MR, 16, { align: 'right' });
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(ML, 19, MR, 19);

  // ── Meter info ────────────────────────────────────────────────────────────
  let y = 27;
  const infoRows = [
    { lbl: 'Bezugsstelle:', val: [m.label, m.adresse].filter(Boolean).join(', ') },
    { lbl: 'Produkt/Tarif:', val: `Energy Blue – Einheitstarif ( ${fmt(periodStart)} – ${fmt(periodEnd)} )` },
    { lbl: 'Messpunkt:', val: m.messpunktNr },
  ];
  if (m.zaehlerNr) infoRows.push({ lbl: 'Zählernummer:', val: m.zaehlerNr });

  infoRows.forEach(({ lbl, val }) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...BLACK);
    doc.text(lbl, ML, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DGRAY);
    const lines = doc.splitTextToSize(val, MR - ML - 26);
    lines.forEach((l, i) => { doc.text(l, ML + 26, y + i * 4); });
    y += Math.max(5, lines.length * 4);
  });

  // ── Messung section ───────────────────────────────────────────────────────
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  doc.text('Messung', ML, y); y += 2;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.4);
  doc.line(ML, y, MR, y); y += 5;

  const cZ = ML, cTar = ML + 22, cD1 = ML + 82, cD2 = ML + 104, cBez = MR;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('Zähler',      cZ,   y);
  doc.text('Tarif',       cTar, y);
  doc.text('Zeitperiode', cD1,  y);
  doc.text('Bezug',       cBez, y, { align: 'right' });
  y += 1.5;
  doc.setDrawColor(...BORDER);
  doc.line(ML, y, MR, y); y += 4.5;

  const months = Object.keys(agg[m.messpunktNr] || {}).sort();
  let totalCons = 0;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...BLACK);
  months.forEach((mk, i) => {
    const d   = agg[m.messpunktNr][mk];
    const kwh = d.cons || 0;
    totalCons += kwh;
    const [yr, mo] = mk.split('-').map(Number);
    const d1str = `01.${String(mo).padStart(2,'0')}.${yr}`;
    const last  = new Date(yr, mo, 0).getDate();
    const d2str = `${last}.${String(mo).padStart(2,'0')}.${yr}`;
    if (i === 0) {
      doc.text(m.zaehlerNr || '–', cZ, y);
      doc.text('Energie/Arbeit Einheitstarif (0 – 24 Uhr)', cTar, y);
    }
    doc.text(d1str,           cD1,  y);
    doc.text(d2str,           cD2,  y);
    doc.text(`${kwh.toFixed(0)} kWh`, cBez, y, { align: 'right' });
    y += 5.5;
  });

  doc.setDrawColor(...BORDER);
  doc.line(ML, y, MR, y); y += 4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Energie/Arbeit Total', cTar, y);
  doc.text(`${totalCons.toFixed(0)} kWh`, cBez, y, { align: 'right' });
  y += 9;

  // ── Fakturierung section ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...BLACK);
  doc.text('Fakturierung', ML, y); y += 2;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.4);
  doc.line(ML, y, MR, y); y += 5;

  const fE = ML, fZP = ML + 62, fBez = ML + 106, fPr = ML + 133, fAmt = MR;

  // Fakturierung header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text('Energie',     fE,   y);
  doc.text('Zeitperiode', fZP,  y);
  doc.text('Bezug',       fBez, y);
  doc.text('Preis',       fPr,  y);
  doc.text('Betrag in CHF', fAmt, y - 2.5, { align: 'right' });
  doc.text('(ohne MWST)', fAmt, y + 1.5, { align: 'right' });
  y += 1.5;
  doc.setDrawColor(...BORDER);
  doc.line(ML, y, MR, y); y += 5;

  const pStr = `${fmt(periodStart)}-${fmt(periodEnd)}`;
  const grundJahr = (tariff.grundtarif * 12).toFixed(2);
  const dayCount  = Math.round((periodEnd - periodStart) / 864e5) + 1;

  function fRow(label, zp, bez, preis, betrag, bold) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...BLACK);
    doc.text(label, fE, y);
    if (zp)    doc.text(zp,    fZP,  y);
    if (bez)   doc.text(bez,   fBez, y);
    if (preis) doc.text(preis, fPr,  y);
    doc.text(betrag, fAmt, y, { align: 'right' });
    y += 5.5;
  }

  fRow('Grundtarif',                pStr, `${dayCount} Tage`, `${grundJahr} CHF/a`,                      fmtCHF(grundtarifTotal));
  fRow('Energie Einheitstarif',     pStr, `${g.toFixed(0)} kWh`, `${(tariff.energyAllIn*100).toFixed(2)} Rp.`, fmtCHF(eb));
  fRow('vZEV-Eigenverbrauch Solar', pStr, `${v.toFixed(0)} kWh`, `${(tariff.vzevPrice*100).toFixed(2)} Rp.`,   fmtCHF(vz));

  if (tariff.pvshareAbo > 0) {
    fRow('PVshare Abo', pStr, `${mc} Mt.`, `${tariff.pvshareAbo.toFixed(2)} CHF/Mt.`, fmtCHF(pvshareTotal));
  }

  // Zwischentotal
  doc.setDrawColor(...BORDER);
  doc.line(ML, y - 2, MR, y - 2);
  fRow('Zwischentotal', '', '', '', fmtCHF(subtotal), true);
  y += 1;

  // Feed-in
  if (fiAmt > 0) {
    fRow('Rückliefervergütung', pStr, `${fiKwh.toFixed(0)} kWh`, `${(tariff.feedIn*100).toFixed(2)} Rp.`, `- ${fmtCHF(fiAmt)}`);
    doc.setDrawColor(...BORDER);
    doc.line(ML, y - 2, MR, y - 2);
    y += 2;
  }

  // Total ohne MWST
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...BLACK);
  doc.text('Total ohne MWST', fE, y);
  doc.text(fmtCHF(total), fAmt, y, { align: 'right' });
  y += 9;

  // ── Zusammenzug ───────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('Zusammenzug Bezugsstelle', fE, y); y += 2;
  doc.setDrawColor(...BORDER);
  doc.line(ML, y, MR, y); y += 5;

  doc.setFont('helvetica', 'normal');
  doc.text('Total ohne MWST', fE, y);
  doc.text(fmtCHF(total), fAmt, y, { align: 'right' }); y += 5.5;
  doc.text('Betrag MWST', fE, y);
  doc.text('0.00', fAmt, y, { align: 'right' }); y += 3;

  doc.setDrawColor(...BORDER);
  doc.line(ML, y, MR, y); y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Zu bezahlender Betrag aus Bezugsstelle', fE, y);
  doc.text(fmtCHF(total), fAmt, y, { align: 'right' });
  doc.setDrawColor(...BLACK);
  doc.setLineWidth(0.5);
  doc.line(fE + 95, y + 2.5, MR, y + 2.5);

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...LGRAY);
  doc.text(`Seite ${pageNum}/${totalPages}`, MR, 285, { align: 'right' });
  doc.text(`Details Ihrer Rechnung  ·  Rechnungs-Nr. ${invNr}`, ML, 285);
}
