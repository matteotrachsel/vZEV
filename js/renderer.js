// ── RENDERER ──────────────────────────────────────────────────────────────────
// All DOM-writing render functions. Take computed data, write to DOM only.

function renderSummary(tot, scRate, ssRate) {
  document.getElementById('summaryCards').innerHTML = `
    <div class="sum-card">  <div class="slabel">Gesamtverbrauch</div>   <div class="sval">${tot.cons.toFixed(0)}</div><div class="sunit">kWh</div></div>
    <div class="sum-card g"><div class="slabel">Produktion Solar</div>   <div class="sval">${tot.prod.toFixed(0)}</div><div class="sunit">kWh</div></div>
    <div class="sum-card g"><div class="slabel">vZEV Eigenverbrauch</div><div class="sval">${tot.vzev.toFixed(0)}</div><div class="sunit">kWh &nbsp;·&nbsp; ${ssRate.toFixed(1)}% Eigendeckung</div></div>
    <div class="sum-card o"><div class="slabel">Netzbezug</div>          <div class="sval">${tot.grid.toFixed(0)}</div><div class="sunit">kWh</div></div>
    <div class="sum-card p"><div class="slabel">Eigenverbrauchsquote</div><div class="sval">${scRate.toFixed(1)}%</div><div class="sunit">der Produktion genutzt</div></div>
    <div class="sum-card r"><div class="slabel">Netzeinspeisung</div>    <div class="sval">${tot.fi.toFixed(0)}</div><div class="sunit">kWh Überschuss</div></div>`;
}

function renderMonthly(monthly, tariff, nV) {
  const months = Object.keys(monthly).sort();
  const ep = `${(tariff.energyAllIn * 100).toFixed(2)} Rp`;
  const vp = `${(tariff.vzevPrice   * 100).toFixed(2)} Rp`;
  document.querySelector('#monthlyTable thead').innerHTML = `<tr>
    <th>Monat</th>
    <th class="tr">Verbrauch kWh</th>
    <th class="tr">Produktion kWh</th>
    <th class="tr">vZEV-Anteil kWh</th>
    <th class="tr">Netzbezug kWh</th>
    <th class="tr">Eigendeckung</th>
    <th class="tr">Einspeisung kWh</th>
    <th class="tr">Energiebezug (${ep})</th>
    <th class="tr">vZEV-Solar (${vp})</th>
    <th class="tr">Grundgebühren</th>
    <th class="tr">Einspeiseverg.</th>
    <th class="tr">Total CHF</th></tr>`;

  let sC=0, sP=0, sV=0, sG=0, sF=0, sEB=0, sVZ=0, sFee=0, sFI=0, sT=0;
  const rows = months.map(mk => {
    const d    = monthly[mk];
    const eigen = d.cons > 0 ? (d.vzev / d.cons) * 100 : 0;
    const eb   = d.grid * tariff.energyAllIn;           // Energiebezug cost
    const vz   = d.vzev * tariff.vzevPrice;             // vZEV solar cost
    const fee  = nV * (tariff.grundtarif + tariff.pvshareAbo); // monthly fees (all meters)
    const fi   = d.fi * tariff.feedIn;                  // feed-in revenue
    const total = eb + vz + fee - fi;
    sC+=d.cons; sP+=d.prod; sV+=d.vzev; sG+=d.grid;
    sF+=d.fi; sEB+=eb; sVZ+=vz; sFee+=fee; sFI+=fi; sT+=total;
    return `<tr><td><strong>${fmtMonth(mk)}</strong></td>
      <td class="tr">${d.cons.toFixed(1)}</td>
      <td class="tr tg">${d.prod.toFixed(1)}</td>
      <td class="tr">${d.vzev.toFixed(1)}</td>
      <td class="tr">${d.grid.toFixed(1)}</td>
      <td class="tr">${eigen.toFixed(1)}%</td>
      <td class="tr">${d.fi.toFixed(1)}</td>
      <td class="tr">${fmtCHF(eb)}</td>
      <td class="tr tg">${fmtCHF(vz)}</td>
      <td class="tr">${fmtCHF(fee)}</td>
      <td class="tr" style="color:var(--green)">–${fmtCHF(fi)}</td>
      <td class="tr tc">${fmtCHF(total)}</td></tr>`;
  });
  rows.push(`<tr class="tfoot">
    <td>Total</td>
    <td class="tr">${sC.toFixed(1)}</td><td class="tr tg">${sP.toFixed(1)}</td>
    <td class="tr">${sV.toFixed(1)}</td><td class="tr">${sG.toFixed(1)}</td>
    <td class="tr">${sC > 0 ? (sV/sC*100).toFixed(1) : 0}%</td>
    <td class="tr">${sF.toFixed(1)}</td>
    <td class="tr">${fmtCHF(sEB)}</td>
    <td class="tr">${fmtCHF(sVZ)}</td>
    <td class="tr">${fmtCHF(sFee)}</td>
    <td class="tr" style="color:var(--green)">–${fmtCHF(sFI)}</td>
    <td class="tr tc">${fmtCHF(sT)}</td></tr>`);
  document.querySelector('#monthlyTable tbody').innerHTML = rows.join('');
}

function renderMeterAgg(agg, meters, distStats, hasPriority) {
  document.querySelector('#meterTable thead').innerHTML = `<tr>
    <th>Bezeichnung</th><th>Messpunkt</th><th>Typ</th>
    <th class="tr">Verbrauch kWh</th><th class="tr">Produktion kWh</th>
    <th class="tr">vZEV-Anteil kWh</th><th class="tr">Netzbezug kWh</th>
    <th class="tr">Eigendeckung</th>
    <th class="tr">Ø Solar-Zuteilung</th>
    <th class="tr">Spanne (Min–Max)</th></tr>`;

  document.querySelector('#meterTable tbody').innerHTML = meters.map(m => {
    let c = 0, v = 0, g = 0, p = 0;
    Object.values(agg[m.messpunktNr] || {}).forEach(d => { c += d.cons; v += d.vzev; g += d.grid; p += d.prod; });
    const isP    = m.typ === 'Produktion';
    const isPrio = m.priority && !isP;
    const typeStyle = isP
      ? 'background:var(--green-light);color:var(--green)'
      : isPrio
        ? 'background:#FEF3DC;color:#8A4F00'
        : 'background:var(--blue-light);color:var(--blue)';
    const typeLabel = isP ? 'Produktion' : isPrio ? '☀ Priorität' : 'Verbrauch';
    const typeTag   = `<span style="font-size:.68rem;font-weight:700;padding:.18rem .5rem;border-radius:2px;${typeStyle}">${typeLabel}</span>`;

    let avgShare = '–', rangeStr = '–';
    if (!isP && distStats?.[m.messpunktNr]?.length) {
      const s   = distStats[m.messpunktNr];
      const avg = s.reduce((a, b) => a + b, 0) / s.length;
      avgShare  = `<strong>${avg.toFixed(1)}%</strong>`;
      rangeStr  = `${Math.min(...s).toFixed(0)}% – ${Math.max(...s).toFixed(0)}%`;
    }

    return `<tr>
      <td><div style="font-weight:700;color:var(--text)">${m.label || '–'}</div>
          ${m.adresse ? `<div style="font-size:.72rem;color:var(--text-muted)">${m.adresse}</div>` : ''}</td>
      <td style="font-size:.65rem;font-family:monospace;color:var(--text-faint);max-width:160px;overflow:hidden;text-overflow:ellipsis">${m.messpunktNr}</td>
      <td>${typeTag}</td>
      <td class="tr">${!isP ? c.toFixed(1) : '–'}</td>
      <td class="tr tg">${p > 0 ? p.toFixed(1) : '–'}</td>
      <td class="tr">${!isP ? v.toFixed(1) : '–'}</td>
      <td class="tr">${!isP ? g.toFixed(1) : '–'}</td>
      <td class="tr">${!isP ? (c > 0 ? (v / c * 100).toFixed(1) : 0) + '%' : '–'}</td>
      <td class="tr">${avgShare}</td>
      <td class="tr" style="color:var(--text-muted)">${rangeStr}</td></tr>`;
  }).join('');
}

function renderCosts(agg, meters, tariff) {
  const mc = getMonthCount();
  const cM = meters.filter(m => m.typ === 'Verbrauch');
  const ep = `${(tariff.energyAllIn * 100).toFixed(2)} Rp`;
  const vp = `${(tariff.vzevPrice   * 100).toFixed(2)} Rp`;

  document.querySelector('#costTable thead').innerHTML = `<tr>
    <th>Zähler / Adresse</th>
    <th class="tr">Netzbezug kWh</th>
    <th class="tr">vZEV kWh</th>
    <th class="tr">Energiebezug (${ep})</th>
    <th class="tr">vZEV-Solar (${vp})</th>
    <th class="tr">Grundgebühren CHF</th>
    <th class="tr">Total CHF</th></tr>`;

  // Pre-compute totals for proportional fee split.
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
  const totalFee  = mc * (tariff.grundtarif + tariff.pvshareAbo);

  let aG = 0, aV = 0, aT = 0;
  const rows = cM.map((m, i) => {
    const g   = meterGrid[i];
    const v   = meterVzev[i];
    const eb  = g * tariff.energyAllIn;
    const vz  = v * tariff.vzevPrice;
    const fee = tariff.splitBase
      ? (totalGrid > 0 ? (g / totalGrid) * cM.length * totalFee : totalFee)
      : totalFee;
    const total = eb + vz + fee;
    aG += g; aV += v; aT += total;
    return `<tr>
      <td><div style="font-weight:700;color:var(--text)">${m.label || m.messpunktNr}</div>
          ${m.adresse   ? `<div style="font-size:.72rem;color:var(--text-muted)">${m.adresse}</div>` : ''}
          ${m.zaehlerNr ? `<div style="font-size:.65rem;color:var(--text-faint)">Zähler ${m.zaehlerNr}</div>` : ''}</td>
      <td class="tr">${g.toFixed(1)}</td>
      <td class="tr tg">${v.toFixed(1)}</td>
      <td class="tr">${fmtCHF(eb)}</td>
      <td class="tr tg">${fmtCHF(vz)}</td>
      <td class="tr">${fmtCHF(fee)}</td>
      <td class="tr tc">${fmtCHF(total)}</td></tr>`;
  });
  rows.push(`<tr class="tfoot"><td>Total</td>
    <td class="tr">${aG.toFixed(1)}</td>
    <td class="tr">${aV.toFixed(1)}</td>
    <td class="tr">–</td><td class="tr">–</td><td class="tr">–</td>
    <td class="tr tc">${fmtCHF(aT)}</td></tr>`);
  document.querySelector('#costTable tbody').innerHTML = rows.join('');
}

function renderCharts(monthly, consMeters, agg) {
  const months = Object.keys(monthly).sort();
  const labels = months.map(fmtMonth);
  const COLORS = ['#0046B0', '#3AAA6A', '#7C5CBF', '#E6900A', '#C0392B', '#0891B2'];

  // Destroy existing instances before recreating.
  if (AppState.charts.monthly) AppState.charts.monthly.destroy();
  if (AppState.charts.pie)     AppState.charts.pie.destroy();
  if (AppState.charts.dist)    AppState.charts.dist.destroy();

  Chart.defaults.font.family = 'Manrope';
  Chart.defaults.color       = '#7A8CA8';

  // Monthly energy flow bar chart.
  AppState.charts.monthly = new Chart(document.getElementById('chartMonthly'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Netzbezug (kWh)',          data: months.map(m => +monthly[m].grid.toFixed(1)), backgroundColor: '#0046B0', borderRadius: 2, barPercentage: .7 },
        { label: 'vZEV-Eigenverbrauch (kWh)', data: months.map(m => +monthly[m].vzev.toFixed(1)), backgroundColor: '#3AAA6A', borderRadius: 2, barPercentage: .7 },
        { label: 'Netzeinspeisung (kWh)',     data: months.map(m => +monthly[m].fi.toFixed(1)),   backgroundColor: '#E6900A', borderRadius: 2, barPercentage: .7 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11, weight: '600' }, boxWidth: 10, boxHeight: 10 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { grid: { color: '#EBF1FB', lineWidth: 1 }, border: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });

  // Doughnut – total energy distribution.
  const tG = Object.values(monthly).reduce((s, m) => s + m.grid, 0);
  const tV = Object.values(monthly).reduce((s, m) => s + m.vzev, 0);
  const tF = Object.values(monthly).reduce((s, m) => s + m.fi, 0);
  AppState.charts.pie = new Chart(document.getElementById('chartPie'), {
    type: 'doughnut',
    data: {
      labels: ['Netzbezug', 'vZEV-Eigenverbrauch', 'Netzeinspeisung'],
      datasets: [{ data: [+tG.toFixed(1), +tV.toFixed(1), +tF.toFixed(1)],
        backgroundColor: ['#0046B0', '#3AAA6A', '#E6900A'],
        borderWidth: 3, borderColor: '#fff', hoverBorderColor: '#fff' }]
    },
    options: {
      responsive: true, cutout: '62%',
      plugins: { legend: { position: 'bottom', labels: { font: { size: 11, weight: '600' }, boxWidth: 10, boxHeight: 10 } } }
    }
  });

  // Stacked bar – monthly % share of vZEV per consumer.
  if (consMeters && agg) {
    const distDatasets = consMeters.map((m, i) => ({
      label:           m.label || m.messpunktNr.slice(-8),
      data:            months.map(mk => {
        const d        = agg[m.messpunktNr]?.[mk];
        const totalVzev = monthly[mk]?.vzev || 0;
        return totalVzev > 0 && d ? +((d.vzev / totalVzev) * 100).toFixed(1) : 0;
      }),
      backgroundColor: COLORS[i % COLORS.length],
      borderRadius:    2,
      barPercentage:   .65
    }));

    AppState.charts.dist = new Chart(document.getElementById('chartDist'), {
      type: 'bar',
      data: { labels, datasets: distDatasets },
      options: {
        responsive: true,
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { stacked: true, min: 0, max: 100,
               grid: { color: '#EBF1FB' }, border: { display: false },
               ticks: { font: { size: 11 }, callback: v => v + '%' } }
        },
        plugins: {
          legend: { position: 'bottom', labels: { font: { size: 11, weight: '600' }, boxWidth: 10, boxHeight: 10 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%` } }
        }
      }
    });
  }
}

function renderMethodologyExample(byTS, consMeters, prodMeters) {
  // Pick the interval with the highest self-consumption where all meters have data.
  let bestTS = null, bestSC = -1;
  Object.entries(byTS).forEach(([ts, slots]) => {
    const prod    = prodMeters.reduce((s, m) => { const sl = slots[m.messpunktNr]; return s + (sl ? Math.max(sl.bezug, sl.einspeisung) : 0); }, 0);
    const totalC  = consMeters.reduce((s, m) => s + (slots[m.messpunktNr]?.bezug || 0), 0);
    const sc      = Math.min(prod, totalC);
    const allData = consMeters.every(m => (slots[m.messpunktNr]?.bezug || 0) > 0);
    if (sc > bestSC && allData) { bestSC = sc; bestTS = ts; }
  });
  if (!bestTS) return;

  const slots    = byTS[bestTS];
  const d        = new Date(parseInt(bestTS, 10));
  const prod     = prodMeters.reduce((s, m) => { const sl = slots[m.messpunktNr]; return s + (sl ? Math.max(sl.bezug, sl.einspeisung) : 0); }, 0);
  const cons     = consMeters.map(m => ({ m, c: slots[m.messpunktNr]?.bezug || 0 }));
  const totalC   = cons.reduce((s, x) => s + x.c, 0);
  const sc       = Math.min(prod, totalC);
  const fi       = Math.max(0, prod - totalC);
  const shares   = cons.map(({ m, c }) => ({ m, c, v: totalC > 0 ? (c / totalC) * sc : 0 }));
  const prodLabel = prodMeters.map(m => m.label || 'Solar').join(' + ');

  const thead = `<tr>
    <th>Grösse</th>
    ${shares.map(({ m }) => `<th class="tr">${m.label || m.messpunktNr.slice(-8)}</th>`).join('')}
    <th class="tr">${prodLabel}</th>
    <th class="tr">vZEV gesamt</th>
  </tr>`;

  const p3 = v => v.toFixed(3);
  const p  = v => `${p3(v)} kWh`;
  const tbody = [
    `<tr><td>Verbrauch C(t)</td>${shares.map(({ c }) => `<td class="tr">${p(c)}</td>`).join('')}<td class="tr">–</td><td class="tr"><strong>${p(totalC)}</strong></td></tr>`,
    `<tr><td>Produktion P(t)</td>${shares.map(() => `<td class="tr">–</td>`).join('')}<td class="tr tg">${p(prod)}</td><td class="tr">–</td></tr>`,
    `<tr><td>Selbstverbrauch SC(t) = min(${p3(prod)}, ${p3(totalC)})</td>${shares.map(() => `<td class="tr">–</td>`).join('')}<td class="tr">–</td><td class="tr tg"><strong>${p(sc)}</strong></td></tr>`,
    `<tr><td>Netzeinspeisung FI(t) = max(0, ${p3(prod)}−${p3(totalC)})</td>${shares.map(() => `<td class="tr">–</td>`).join('')}<td class="tr">–</td><td class="tr" style="color:var(--amber)"><strong>${p(fi)}</strong></td></tr>`,
    `<tr><td>Solar-Anteil V(t) = C&nbsp;/&nbsp;${p3(totalC)}&nbsp;×&nbsp;${p3(sc)}</td>${shares.map(({ c, v }) => `<td class="tr tg">${p3(c)}/${p3(totalC)} × ${p3(sc)} = <strong>${p(v)}</strong></td>`).join('')}<td class="tr">–</td><td class="tr tg"><strong>${p(sc)}</strong></td></tr>`,
    `<tr><td>Netzbezug G(t) = C − V</td>${shares.map(({ c, v }) => `<td class="tr">${p3(c)} − ${p3(v)} = <strong>${p(c - v)}</strong></td>`).join('')}<td class="tr">–</td><td class="tr"><strong>${p(totalC - sc)}</strong></td></tr>`
  ].join('');

  const table = document.getElementById('exampleTable');
  table.querySelector('thead').innerHTML = thead;
  table.querySelector('tbody').innerHTML = tbody;

  document.getElementById('exampleTitle').textContent =
    `Zahlenbeispiel – ${d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })} ${d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })} Uhr`;
  const ph = document.getElementById('examplePlaceholder');
  if (ph) ph.textContent = '· Intervall mit höchstem Eigenverbrauch aus den hochgeladenen Daten';
}
