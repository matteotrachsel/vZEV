// ── CALCULATOR ────────────────────────────────────────────────────────────────
// vZEV distribution algorithm and main orchestrator.

function getMonthCount() {
  if (!AppState.parsedData.length) return 1;
  const ts = AppState.parsedData.map(r => r.datum.getTime());
  const a  = new Date(Math.min(...ts));
  const b  = new Date(Math.max(...ts));
  return Math.max(1, (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1);
}

function calculateAndRender() {
  const meters     = getMeterConfig();
  const tariff     = getTariff();
  const prodMeters = meters.filter(m => m.typ === 'Produktion');
  const consMeters = meters.filter(m => m.typ === 'Verbrauch');

  if (!consMeters.length) { alert('Mindestens einen Verbrauch-Messpunkt konfigurieren.'); return; }
  if (!prodMeters.length) { alert('Mindestens einen Produktions-Messpunkt konfigurieren.'); return; }

  // Index all readings by timestamp for O(1) lookup.
  const byTS = {};
  AppState.parsedData.forEach(r => {
    if (!meters.find(m => m.messpunktNr === r.messpunkt)) return;
    const ts = r.datum.getTime();
    if (!byTS[ts]) byTS[ts] = {};
    byTS[ts][r.messpunkt] = r;
  });

  // Aggregation buckets.
  const agg       = {};
  meters.forEach(m => { agg[m.messpunktNr] = {}; });
  const monthly   = {};
  const distStats = {};
  consMeters.forEach(m => { distStats[m.messpunktNr] = []; });

  // ── Per-interval proportional distribution ────────────────────────────────
  Object.entries(byTS).forEach(([ts, slots]) => {
    const d  = new Date(parseInt(ts, 10));
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    const prod   = prodMeters.reduce((s, m) => {
      const sl = slots[m.messpunktNr];
      return s + (sl ? Math.max(sl.bezug, sl.einspeisung) : 0);
    }, 0);

    const consList = consMeters.map(m => ({ m, c: slots[m.messpunktNr]?.bezug || 0 }));
    const totalC   = consList.reduce((s, x) => s + x.c, 0);
    const sc       = Math.min(prod, totalC);
    const fi       = Math.max(0, prod - totalC);

    consList.forEach(({ m, c }) => {
      const vzev = totalC > 0 ? (c / totalC) * sc : 0;
      if (!agg[m.messpunktNr][mk]) agg[m.messpunktNr][mk] = { cons: 0, vzev: 0, grid: 0, prod: 0 };
      agg[m.messpunktNr][mk].cons += c;
      agg[m.messpunktNr][mk].vzev += vzev;
      agg[m.messpunktNr][mk].grid += c - vzev;
      if (sc > 0 && totalC > 0) distStats[m.messpunktNr].push((c / totalC) * 100);
    });

    prodMeters.forEach(pm => {
      const sl  = slots[pm.messpunktNr];
      const pmP = sl ? Math.max(sl.bezug, sl.einspeisung) : 0;
      if (!agg[pm.messpunktNr][mk]) agg[pm.messpunktNr][mk] = { cons: 0, vzev: 0, grid: 0, prod: 0 };
      agg[pm.messpunktNr][mk].prod += pmP;
    });

    if (!monthly[mk]) monthly[mk] = { cons: 0, vzev: 0, grid: 0, prod: 0, sc: 0, fi: 0 };
    monthly[mk].cons += totalC;
    monthly[mk].prod += prod;
    monthly[mk].sc   += sc;
    monthly[mk].fi   += fi;
    monthly[mk].vzev += sc;
    monthly[mk].grid += totalC - sc;
  });

  // ── Totals ────────────────────────────────────────────────────────────────
  const tot = { cons: 0, vzev: 0, grid: 0, prod: 0, sc: 0, fi: 0 };
  Object.values(monthly).forEach(m => {
    tot.cons += m.cons; tot.vzev += m.vzev; tot.grid += m.grid;
    tot.prod += m.prod; tot.sc   += m.sc;   tot.fi   += m.fi;
  });
  const scRate = tot.prod > 0 ? (tot.sc   / tot.prod) * 100 : 0;
  const ssRate = tot.cons > 0 ? (tot.vzev / tot.cons) * 100 : 0;

  const dates       = AppState.parsedData.map(r => r.datum.getTime());
  const periodStart = new Date(Math.min(...dates));
  const periodEnd   = new Date(Math.max(...dates));
  document.getElementById('periodInfo').textContent =
    `${fmt(periodStart)} – ${fmt(periodEnd)}`;

  // Persist result so invoice generator can access it without recalculating.
  AppState.lastResult = { agg, monthly, tot, scRate, ssRate, meters, tariff, distStats, periodStart, periodEnd };

  // ── Render all sections ───────────────────────────────────────────────────
  renderSummary(tot, scRate, ssRate);
  renderMonthly(monthly, tariff, consMeters.length);
  renderMeterAgg(agg, meters, distStats);
  renderCosts(agg, meters, tariff);
  renderCharts(monthly, consMeters, agg);
  renderDayProfile(byTS, meters);
  renderTimeline(byTS, meters);
  renderOptimisation(byTS, meters);
  renderMethodologyExample(byTS, consMeters, prodMeters);

  document.getElementById('results').classList.remove('hidden');
  setStep(3);
  document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
