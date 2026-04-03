// ── INVOICE (PDF) ─────────────────────────────────────────────────────────────
// Generates a professional A4 PDF invoice for each consumption meter.
// Requires jsPDF + jsPDF-AutoTable (loaded via CDN in index.html).

function exportPDF() {
  const result = AppState.lastResult;
  if (!result) {
    alert('Bitte zuerst eine Auswertung erstellen.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const { agg, monthly, tot, scRate, ssRate, meters, tariff, periodStart, periodEnd } = result;
  const cM      = meters.filter(m => m.typ === 'Verbrauch');
  const mc      = getMonthCount();
  const totalFee = mc * (tariff.grundtarif + tariff.pvshareAbo);
  const header   = getInvoiceHeader();

  // Pre-compute per-meter grid/vzev totals.
  const meterGrid = cM.map(m => {
    let g = 0;
    Object.values(agg[m.messpunktNr] || {}).forEach(d => { g += d.grid; });
    return g;
  });
  const meterVzev = cM.map(m => {
    let v = 0;
    Object.values(agg[m.messpunktNr] || {}).forEach(d => { v += d.vzev; });
    return v;
  });
  const totalGrid = meterGrid.reduce((s, g) => s + g, 0);

  const today     = new Date();
  const dateStr   = today.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const periodStr = `${fmt(periodStart)} – ${fmt(periodEnd)}`;
  const invBase   = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

  cM.forEach((m, idx) => {
    if (idx > 0) doc.addPage();

    const g   = meterGrid[idx];
    const v   = meterVzev[idx];
    let cons  = 0;
    Object.values(agg[m.messpunktNr] || {}).forEach(d => { cons += d.cons; });

    const eb    = g * tariff.energyAllIn;
    const vz    = v * tariff.vzevPrice;
    const fee   = tariff.splitBase
      ? (totalGrid > 0 ? (g / totalGrid) * cM.length * totalFee : totalFee)
      : totalFee;
    const total = eb + vz + fee;
    const invNr = `${invBase}-${String(idx + 1).padStart(2, '0')}`;

    drawInvoicePage(doc, {
      m, g, v, cons, eb, vz, fee, total,
      tariff, mc, periodStr, dateStr, invNr,
      scRate, ssRate, tot, header
    });
  });

  doc.save(`vZEV_Rechnung_${today.toISOString().slice(0, 10)}.pdf`);
}

// ── Page renderer ─────────────────────────────────────────────────────────────

function drawInvoicePage(doc, p) {
  const PW = 210, PH = 297;
  const ML = 20, MR = 190;
  const W  = MR - ML;

  // ── Color palette ────────────────────────────────────────────────────────────
  const blue      = [0, 70, 176];
  const darkText  = [25, 25, 35];
  const midText   = [90, 100, 115];
  const lightText = [155, 163, 180];
  const border    = [215, 222, 235];
  const green     = [45, 158, 95];

  const hdr = p.header || {};

  // ── Thin top bar ─────────────────────────────────────────────────────────────
  doc.setFillColor(...blue);
  doc.rect(0, 0, PW, 3.5, 'F');

  // ── SENDER block (top left) ───────────────────────────────────────────────
  let y = 13;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...blue);
  doc.text(hdr.name || 'vZEV Ogimatte', ML, y);

  y += 4.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...midText);
  if (hdr.street) { doc.text(hdr.street, ML, y); y += 4; }
  if (hdr.city)   { doc.text(hdr.city,   ML, y); y += 4; }
  if (hdr.contact){ doc.text(hdr.contact, ML, y); y += 4; }

  // ── RECHNUNG title + info (top right) ────────────────────────────────────
  const rx = MR;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...darkText);
  doc.text('RECHNUNG', rx, 16, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...midText);
  const metaLines = [
    `Rechnungs-Nr. ${p.invNr}`,
    `Datum:          ${p.dateStr}`,
    `Periode:        ${p.periodStr}`,
    `Dauer:          ${p.mc} Monat${p.mc !== 1 ? 'e' : ''}`
  ];
  metaLines.forEach((line, i) => {
    doc.text(line, rx, 23 + i * 4.5, { align: 'right' });
  });

  // ── Divider ───────────────────────────────────────────────────────────────
  const div1Y = 44;
  doc.setDrawColor(...border);
  doc.setLineWidth(0.35);
  doc.line(ML, div1Y, MR, div1Y);

  // ── RECIPIENT block (window position) ────────────────────────────────────
  y = 51;
  // small "sender line" above address (standard Swiss letter format)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...lightText);
  const senderLine = [hdr.name, hdr.city].filter(Boolean).join(' · ');
  doc.text(senderLine, ML, y);

  y += 5.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(...darkText);
  doc.text(p.m.label || p.m.messpunktNr, ML, y);

  y += 5;
  if (p.m.adresse) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(55, 60, 70);
    doc.text(p.m.adresse, ML, y);
    y += 5;
  }

  // ── Meter details (right column, parallel to address) ────────────────────
  const dtX = ML + W * 0.54;
  let dy = 57;
  [
    { label: 'Zähler-Nr.',  val: p.m.zaehlerNr || '—' },
    { label: 'Messpunkt',   val: '…' + p.m.messpunktNr.slice(-12) },
  ].forEach(d => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...lightText);
    doc.text(d.label, dtX, dy);
    dy += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...darkText);
    doc.text(d.val, dtX, dy);
    dy += 6;
  });

  // ── Second divider ────────────────────────────────────────────────────────
  const div2Y = 88;
  doc.setDrawColor(...border);
  doc.setLineWidth(0.35);
  doc.line(ML, div2Y, MR, div2Y);

  // ── ENERGY SUMMARY BOXES ─────────────────────────────────────────────────
  y = 94;
  const eigenPct = p.cons > 0 ? (p.v / p.cons * 100).toFixed(1) : '0.0';
  const boxes = [
    { label: 'Gesamtverbrauch',         val: p.cons.toFixed(1), unit: 'kWh',                accent: blue  },
    { label: 'vZEV-Eigenverbrauch',     val: p.v.toFixed(1),    unit: `kWh (${eigenPct}%)`, accent: green },
    { label: 'Netzbezug (abgerechnet)', val: p.g.toFixed(1),    unit: 'kWh',                accent: [210, 105, 15] }
  ];
  const boxW = (W - 4) / 3;
  boxes.forEach((b, i) => {
    const bx = ML + i * (boxW + 2);
    doc.setFillColor(249, 250, 253);
    doc.setDrawColor(...border);
    doc.setLineWidth(0.28);
    doc.rect(bx, y, boxW, 23, 'FD');
    doc.setFillColor(...b.accent);
    doc.rect(bx, y, boxW, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(...lightText);
    doc.text(b.label.toUpperCase(), bx + boxW / 2, y + 10.5, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...darkText);
    doc.text(b.val, bx + boxW / 2, y + 17, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(...lightText);
    doc.text(b.unit, bx + boxW / 2, y + 21.5, { align: 'center' });
  });

  // ── COST TABLE ────────────────────────────────────────────────────────────
  y = 124;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(...midText);
  doc.text('KOSTENPOSITIONEN', ML, y);
  y += 3;

  doc.autoTable({
    startY: y,
    margin: { left: ML, right: PW - MR },
    tableWidth: W,
    head: [['Position', 'Menge', 'Tarif', 'Betrag CHF']],
    body: [
      ['Energiebezug BKW (all-in)',  `${p.g.toFixed(1)} kWh`, `${(p.tariff.energyAllIn * 100).toFixed(2)} Rp/kWh`, fmtCHF(p.eb)],
      ['vZEV-Eigenverbrauch Solar',  `${p.v.toFixed(1)} kWh`, `${(p.tariff.vzevPrice   * 100).toFixed(2)} Rp/kWh`, fmtCHF(p.vz)],
      ['Grundtarif BKW',             `${p.mc} Mt.`,           `${p.tariff.grundtarif.toFixed(2)} CHF/Mt.`,          fmtCHF(p.mc * p.tariff.grundtarif)],
      ['PVshare Abo',                `${p.mc} Mt.`,           `${p.tariff.pvshareAbo.toFixed(2)} CHF/Mt.`,          fmtCHF(p.mc * p.tariff.pvshareAbo)]
    ],
    headStyles: {
      fillColor: [...blue],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 }
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 28 },
      2: { halign: 'right', cellWidth: 40 },
      3: { halign: 'right', fontStyle: 'bold', cellWidth: 28 }
    },
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
      lineColor: [...border],
      lineWidth: 0.25,
      textColor: [55, 62, 75]
    },
    alternateRowStyles: { fillColor: [249, 250, 253] }
  });

  // ── TOTAL BOX ─────────────────────────────────────────────────────────────
  const tblBottom = doc.lastAutoTable.finalY;
  const totBoxY   = tblBottom + 3;
  const totBoxH   = 17;
  const totBoxW   = 80;

  // Light left side note
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...midText);
  doc.text(`Zahlbar innert ${p.header?.paymentTerm || '30 Tage'} ab Rechnungsdatum.`, ML, totBoxY + 7);
  if (p.header?.iban) {
    doc.text(`IBAN: ${p.header.iban}`, ML, totBoxY + 12.5);
  }

  // Total box (right-aligned)
  doc.setFillColor(...blue);
  doc.rect(MR - totBoxW, totBoxY, totBoxW, totBoxH, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(160, 195, 235);
  doc.text('TOTAL NETTO (exkl. MwSt.)', MR - 4, totBoxY + 5.5, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.text(`CHF ${fmtCHF(p.total)}`, MR - 4, totBoxY + 14, { align: 'right' });

  // ── CALCULATION NOTE ──────────────────────────────────────────────────────
  y = totBoxY + totBoxH + 11;
  doc.setLineWidth(1.5);
  doc.setDrawColor(...green);
  doc.line(ML, y, ML, y + 20);
  doc.setLineWidth(0.3);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(30, 110, 65);
  doc.text('Berechnungshinweis', ML + 5, y + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(70, 78, 90);
  const note =
    `Der Netzbezug basiert auf der 15-Minuten-Messung des Smartmeters. ` +
    `Der vZEV-Eigenverbrauch (${p.v.toFixed(1)} kWh, ${eigenPct}% des Gesamtverbrauchs) ist bereits abgezogen – ` +
    `nur der verbleibende Netzbezug (${p.g.toFixed(1)} kWh) wird zum BKW-Tarif verrechnet. ` +
    `Eigenverbrauchsquote vZEV: ${p.scRate.toFixed(1)}%  ·  Eigendeckungsgrad: ${p.ssRate.toFixed(1)}%.`;
  doc.text(doc.splitTextToSize(note, W - 9), ML + 5, y + 10.5);

  // ── FOOTER ────────────────────────────────────────────────────────────────
  const footY = PH - 18;
  doc.setDrawColor(...border);
  doc.setLineWidth(0.3);
  doc.line(ML, footY, MR, footY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...lightText);
  doc.text([hdr.name, hdr.city].filter(Boolean).join('  ·  '), ML, footY + 5);
  doc.text(`Rechnungs-Nr. ${p.invNr}`, MR, footY + 5, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(...lightText);
  doc.text('Berechnung vollständig im Browser  ·  github.com/matteotrachsel/vZEV', ML, footY + 9.5);

  // thin bottom bar
  doc.setFillColor(...blue);
  doc.rect(0, PH - 3.5, PW, 3.5, 'F');
}
