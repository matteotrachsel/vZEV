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
  const cM        = meters.filter(m => m.typ === 'Verbrauch');
  const mc        = getMonthCount();
  const totalBase = mc * tariff.bp;

  // Pre-compute grid totals (needed for proportional base-fee split).
  const meterGrid = cM.map(m => {
    let g = 0;
    Object.values(agg[m.messpunktNr] || {}).forEach(d => { g += d.grid; });
    return g;
  });
  const totalGrid = meterGrid.reduce((s, g) => s + g, 0);

  const today     = new Date();
  const dateStr   = today.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const periodStr = `${fmt(periodStart)} – ${fmt(periodEnd)}`;
  // Invoice number: YYYYMM-01, YYYYMM-02, …
  const invBase   = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

  cM.forEach((m, idx) => {
    if (idx > 0) doc.addPage();

    const g  = meterGrid[idx];
    let cons = 0, vzev = 0;
    Object.values(agg[m.messpunktNr] || {}).forEach(d => { cons += d.cons; vzev += d.vzev; });

    const ec    = g * tariff.ep;
    const nc    = g * tariff.np;
    const lc    = g * tariff.lp;
    const bc    = tariff.splitBase
      ? (totalGrid > 0 ? (g / totalGrid) * totalBase : totalBase / cM.length)
      : mc * tariff.bp;
    const total = ec + nc + lc + bc;
    const invNr = `${invBase}-${String(idx + 1).padStart(2, '0')}`;

    drawInvoicePage(doc, {
      m, g, cons, vzev, ec, nc, lc, bc, total,
      tariff, mc, periodStr, dateStr, invNr,
      scRate, ssRate, tot
    });
  });

  doc.save(`vZEV_Rechnung_${today.toISOString().slice(0, 10)}.pdf`);
}

// ── Page renderer ─────────────────────────────────────────────────────────────

function drawInvoicePage(doc, p) {
  const PW = 210, PH = 297;
  const ML = 18, MR = 192;
  const W  = MR - ML;

  // ── Header ────────────────────────────────────────────────────────────────
  doc.setFillColor(11, 34, 71);
  doc.rect(0, 0, PW, 30, 'F');

  // Logo mark (simplified triangle)
  doc.setFillColor(255, 255, 255, 0.9);
  doc.setDrawColor(255, 255, 255);
  // outer triangle
  doc.setFillColor(230, 235, 245);
  doc.triangle(ML, 22, ML + 9, 8, ML + 18, 22, 'F');
  // inner triangle (blue)
  doc.setFillColor(0, 70, 176);
  doc.triangle(ML + 4.5, 22, ML + 9, 14, ML + 13.5, 22, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text('vZEV', ML + 22, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(160, 185, 220);
  doc.text('Zusammenschluss zum Eigenverbrauch · Ogimatte, Reichenbach im Kandertal', ML + 22, 21.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('STROMKOSTENABRECHNUNG', MR, 15, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(160, 185, 220);
  doc.text(`Rechnungs-Nr. ${p.invNr}`, MR, 21.5, { align: 'right' });

  // ── Meta bar ──────────────────────────────────────────────────────────────
  let y = 38;
  doc.setFillColor(244, 247, 253);
  doc.setDrawColor(212, 220, 234);
  doc.setLineWidth(0.3);
  doc.rect(ML, y, W, 14, 'FD');

  const cols = [
    { label: 'Rechnungsdatum', val: p.dateStr,   x: ML + 5 },
    { label: 'Abrechnungsperiode', val: p.periodStr, x: ML + W * 0.35 },
    { label: 'Dauer',          val: `${p.mc} Monat${p.mc !== 1 ? 'e' : ''}`, x: MR - 5, align: 'right' }
  ];
  cols.forEach(c => {
    const align = c.align || 'left';
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(122, 140, 168);
    doc.text(c.label.toUpperCase(), c.x, y + 4.5, { align });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(11, 24, 38);
    doc.text(c.val, c.x, y + 10, { align });
  });

  // ── Recipient ─────────────────────────────────────────────────────────────
  y = 60;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.5);
  doc.setTextColor(122, 140, 168);
  doc.text('EMPFÄNGER / MESSPUNKT', ML, y);

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(11, 24, 38);
  doc.text(p.m.label || p.m.messpunktNr, ML, y);

  y += 5.5;
  if (p.m.adresse) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(61, 79, 107);
    doc.text(p.m.adresse, ML, y);
    y += 5;
  }

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(122, 140, 168);
  if (p.m.zaehlerNr) {
    doc.text(`Zähler-Nr.: ${p.m.zaehlerNr}`, ML, y);
    y += 4;
  }
  doc.text(`Messpunkt: ${p.m.messpunktNr}`, ML, y);

  // ── Energy summary boxes ──────────────────────────────────────────────────
  y = 95;
  const eigenPct = p.cons > 0 ? (p.vzev / p.cons * 100).toFixed(1) : '0.0';
  const summaryBoxes = [
    { label: 'Gesamtverbrauch',         val: p.cons.toFixed(1),   unit: 'kWh',         color: [0, 70, 176] },
    { label: 'vZEV-Eigenverbrauch',     val: p.vzev.toFixed(1),   unit: `kWh (${eigenPct}%)`, color: [58, 170, 106] },
    { label: 'Netzbezug (abgerechnet)', val: p.g.toFixed(1),      unit: 'kWh',         color: [230, 144, 10] }
  ];

  const boxW = (W - 4) / 3;
  summaryBoxes.forEach((b, i) => {
    const bx = ML + i * (boxW + 2);
    doc.setFillColor(248, 250, 253);
    doc.setDrawColor(212, 220, 234);
    doc.setLineWidth(0.3);
    doc.rect(bx, y, boxW, 20, 'FD');
    doc.setFillColor(...b.color);
    doc.rect(bx, y, boxW, 2.5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(122, 140, 168);
    doc.text(b.label.toUpperCase(), bx + boxW / 2, y + 8, { align: 'center' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(11, 24, 38);
    doc.text(b.val, bx + boxW / 2, y + 14.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(122, 140, 168);
    doc.text(b.unit, bx + boxW / 2, y + 18.5, { align: 'center' });
  });

  // ── Cost table ────────────────────────────────────────────────────────────
  y = 122;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(61, 79, 107);
  doc.text('KOSTENPOSITIONEN', ML, y);
  y += 2;

  doc.autoTable({
    startY: y,
    margin: { left: ML, right: PW - MR },
    tableWidth: W,
    head: [['Position', 'Menge', 'Tarif', 'Betrag CHF']],
    body: [
      ['Netzenergie (Energiepreis)',  `${p.g.toFixed(1)} kWh`,  `${(p.tariff.ep * 100).toFixed(2)} Rp/kWh`,  fmtCHF(p.ec)],
      ['Netznutzung (Arbeit)',        `${p.g.toFixed(1)} kWh`,  `${(p.tariff.np * 100).toFixed(2)} Rp/kWh`,  fmtCHF(p.nc)],
      ['KEV / Bundesabgaben',         `${p.g.toFixed(1)} kWh`,  `${(p.tariff.lp * 100).toFixed(2)} Rp/kWh`,  fmtCHF(p.lc)],
      ['Grundgebühr',                 `${p.mc} Mt.`,             `${p.tariff.bp.toFixed(2)} CHF/Mt.`,          fmtCHF(p.bc)]
    ],
    foot: [['TOTAL NETTO', '', '', fmtCHF(p.total) + ' CHF']],
    headStyles: {
      fillColor: [11, 34, 71],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: { top: 4, bottom: 4, left: 4, right: 4 }
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 32 },
      2: { halign: 'right', cellWidth: 38 },
      3: { halign: 'right', fontStyle: 'bold', cellWidth: 28 }
    },
    footStyles: {
      fillColor: [11, 34, 71],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 10,
      halign: 'right',
      cellPadding: { top: 5, bottom: 5, left: 4, right: 4 }
    },
    styles: {
      fontSize: 8.5,
      cellPadding: { top: 3.5, bottom: 3.5, left: 4, right: 4 },
      lineColor: [212, 220, 234],
      lineWidth: 0.25,
      textColor: [61, 79, 107]
    },
    alternateRowStyles: { fillColor: [248, 250, 253] }
  });

  // ── Calculation note ──────────────────────────────────────────────────────
  y = doc.lastAutoTable.finalY + 9;
  doc.setLineWidth(1);
  doc.setDrawColor(58, 170, 106);
  doc.line(ML, y, ML, y + 20);
  doc.setLineWidth(0.3);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(26, 107, 60);
  doc.text('Berechnungshinweis', ML + 5, y + 4.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(61, 79, 107);
  const note =
    `Der Netzbezug basiert auf der 15-Minuten-Messung des Smartmeters. ` +
    `Der vZEV-Eigenverbrauch (${p.vzev.toFixed(1)} kWh, ${eigenPct}% des Gesamtverbrauchs) ist bereits abgezogen – ` +
    `nur der verbleibende Netzbezug (${p.g.toFixed(1)} kWh) wird verrechnet. ` +
    `Eigenverbrauchsquote vZEV (gesamt): ${p.scRate.toFixed(1)}% · Eigendeckungsgrad: ${p.ssRate.toFixed(1)}%.`;
  const noteLines = doc.splitTextToSize(note, W - 9);
  doc.text(noteLines, ML + 5, y + 9.5);

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.setFillColor(11, 34, 71);
  doc.rect(0, PH - 18, PW, 18, 'F');

  doc.setDrawColor(0, 70, 176);
  doc.setLineWidth(0.5);
  doc.line(0, PH - 18, PW, PH - 18);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(255, 255, 255);
  doc.text('vZEV Ogimatte', PW / 2, PH - 11.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(122, 155, 200);
  doc.text('Zusammenschluss zum Eigenverbrauch · Reichenbach im Kandertal', PW / 2, PH - 7.5, { align: 'center' });
  doc.text('Berechnung vollständig im Browser · github.com/matteotrachsel/vZEV', PW / 2, PH - 4, { align: 'center' });
}
