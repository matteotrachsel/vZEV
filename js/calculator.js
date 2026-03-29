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
  const prioMeters = meters.filter(m => m.typ === 'Verbrauch' && m.priority);
  const normMeters = meters.filter(m => m.typ === 'Verbrauch' && !m.priority);
  const consMeters = meters.filter(m => m.typ === 'Verbrauch');

  if (!consMeters.length) { alert('Mindestens einen Verbrauch-Messpunkt konfigurieren.'); return; }
  if (!prodMeters.length) { alert('Mindestens einen Produktions-Messpunkt konfigurieren.'); return; }

  const hasPriority = prioMeters.length > 0;

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

  // ── Per-interval distribution ─────────────────────────────────────────────
  Object.entries(byTS).forEach(([ts, slots]) => {
    const d  = new Date(parseInt(ts, 10));
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

    const prod = prodMeters.reduce((s, m) => {
      const sl = slots[m.messpunktNr];
      return s + (sl ? Math.max(sl.bezug, sl.einspeisung) : 0);
    }, 0);

    // Step 1: priority meters consume solar first (proportional among themselves).
    const prioCons  = prioMeters.map(m => ({ m, c: slots[m.messpunktNr]?.bezug || 0 }));
    const totalPrio = prioCons.reduce((s, x) => s + x.c, 0);
    const scPrio    = Math.min(prod, totalPrio);

    prioCons.forEach(({ m, c }) => {
      const vzev = totalPrio > 0 ? (c / totalPrio) * scPrio : 0;
      if (!agg[m.messpunktNr][mk]) agg[m.messpunktNr][mk] = { cons: 0, vzev: 0, grid: 0, prod: 0 };
      agg[m.messpunktNr][mk].cons += c;
      agg[m.messpunktNr][mk].vzev += vzev;
      agg[m.messpunktNr][mk].grid += c - vzev;
      if (scPrio > 0 && totalPrio > 0) distStats[m.messpunktNr].push((c / totalPrio) * 100);
    });

    // Step 2: surplus solar distributed proportionally to non-priority meters.
    const prodLeft  = Math.max(0, prod - scPrio);
    const normCons  = normMeters.map(m => ({ m, c: slots[m.messpunktNr]?.bezug || 0 }));
    const totalNorm = normCons.reduce((s, x) => s + x.c, 0);
    const scNorm    = Math.min(prodLeft, totalNorm);

    normCons.forEach(({ m, c }) => {
      const vzev = totalNorm > 0 ? (c / totalNorm) * scNorm : 0;
      if (!agg[m.messpunktNr][mk]) agg[m.messpunktNr][mk] = { cons: 0, vzev: 0, grid: 0, prod: 0 };
      agg[m.messpunktNr][mk].cons += c;
      agg[m.messpunktNr][mk].vzev += vzev;
      agg[m.messpunktNr][mk].grid += c - vzev;
      if (scNorm > 0 && totalNorm > 0) distStats[m.messpunktNr].push((c / totalNorm) * 100);
    });

    const totalC = totalPrio + totalNorm;
    const sc     = scPrio + scNorm;
    const fi     = Math.max(0, prod - totalC);

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
  renderMeterAgg(agg, meters, distStats, hasPriority);
  renderCosts(agg, meters, tariff);
  renderCharts(monthly, consMeters, agg);
  renderMethodologyExample(byTS, consMeters, prodMeters);

  document.getElementById('results').classList.remove('hidden');
  setStep(3);
  document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
