// ── CALCULATOR ────────────────────────────────────────────────────────────────
// vZEV distribution algorithm and main orchestrator.

// ── Grundkosten (Fixkosten) des Zusammenschlusses ─────────────────────────────
// BKW verrechnet dem vZEV als Ganzes: Grundpreise Energie + Netz einmal, Messung
// pro physischem Zähler und die virtuelle Messstelle – pro Tag (Jahrespreis/365).
// Aufteilung auf die Teilnehmenden (Verbrauchs-Messpunkte):
//   equal  – alles gleichmässig (unter Eigentümern frei vereinbar)
//   tenant – Messung gleichmässig, Grundpreise nach Netzbezug; Art. 16a Abs. 2 EnV
//            verlangt bei Mietern eine verbrauchsabhängige Verrechnung der externen
//            Kosten, ausgenommen die Messung des Zusammenschlusses.

// Kalendertage zwischen zwei Zeitpunkten, beide Tage eingeschlossen.
function calendarDays(a, b) {
  const da = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const db = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.max(0, Math.round((db - da) / 864e5) + 1);
}

// Physische Zähler: unterschiedliche Zählernummern der konfigurierten Messpunkte
// (PV und Verbrauch am selben Anschluss teilen sich einen Zähler).
function physicalMeterCount(meters) {
  const ids = new Set(meters.map(m => m.zaehlerNr ? 'z:' + m.zaehlerNr : 'mp:' + m.messpunktNr));
  return ids.size;
}

function allocateFixedCosts(agg, meters, tariff, periodStart, periodEnd) {
  const f        = tariff.fixed;
  const cons     = meters.filter(m => m.typ === 'Verbrauch');
  const nMeters  = physicalMeterCount(meters);
  const days     = calendarDays(periodStart, periodEnd);
  const perYear  = { base: f.base, meter: f.meter * nMeters, virtual: f.virtual };
  const yearTotal = perYear.base + perYear.meter + perYear.virtual;

  const baseTotal = perYear.base * days / 365;
  const messTotal = (perYear.meter + perYear.virtual) * days / 365;

  const gridOf  = m => Object.values(agg[m.messpunktNr] || {}).reduce((s, d) => s + d.grid, 0);
  const grids   = cons.map(gridOf);
  const gridSum = grids.reduce((s, g) => s + g, 0);
  const n       = cons.length || 1;

  const per = {};
  cons.forEach((m, i) => {
    const baseShare = f.split === 'tenant' && gridSum > 0 ? grids[i] / gridSum : 1 / n;
    const messShare = 1 / n;
    per[m.messpunktNr] = {
      baseShare, messShare,
      base: baseTotal * baseShare,
      mess: messTotal * messShare
    };
  });

  // Fixkosten des vZEV pro Monat (Tage des Monats innerhalb der Periode).
  const monthFee = mk => {
    const [y, mo] = mk.split('-').map(Number);
    const from = new Date(Math.max(new Date(y, mo - 1, 1), periodStart));
    const to   = new Date(Math.min(new Date(y, mo, 0, 23, 59), periodEnd));
    return yearTotal * (to >= from ? calendarDays(from, to) : 0) / 365;
  };

  return { split: f.split, days, nMeters, nParticipants: cons.length, perYear, yearTotal, baseTotal, messTotal, per, monthFee };
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

  // ── Per-interval distribution ─────────────────────────────────────────────
  // Zwei Stufen, wie sie der Netzbetreiber (BKW) abrechnet:
  //  1. Eigenverbrauch – eine PV-Anlage deckt zuerst den Verbrauch am eigenen
  //     Anschluss (Zuordnung über die gemeinsame Zählernummer).
  //  2. vZEV-Pool      – nur der Überschuss geht an den Zusammenschluss und
  //     wird dort proportional zum Restbedarf verteilt.
  // Eine rein proportionale Verteilung über alle Bezugsstellen würde dem
  // Produzenten zu wenig und den übrigen Teilnehmern zu viel Solarstrom
  // zuweisen und damit vom Netzbetreiber abweichen.
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

    // Offener Restbedarf und noch nicht zugeteilte Produktion je Messpunkt.
    const rest = new Map(consList.map(({ m, c }) => [m.messpunktNr, c]));
    const own  = new Map(consList.map(({ m })    => [m.messpunktNr, 0]));

    // Stufe 1 – Eigenverbrauch am eigenen Anschluss.
    let pool = 0;
    prodMeters.forEach(pm => {
      const sl  = slots[pm.messpunktNr];
      let   p   = sl ? Math.max(sl.bezug, sl.einspeisung) : 0;
      const own1 = pm.zaehlerNr
        ? consMeters.filter(cm => cm.zaehlerNr && cm.zaehlerNr === pm.zaehlerNr)
        : [];
      const demand = own1.reduce((s, cm) => s + rest.get(cm.messpunktNr), 0);
      if (demand > 0) {
        const supply = Math.min(p, demand);
        own1.forEach(cm => {
          const share = (rest.get(cm.messpunktNr) / demand) * supply;
          own.set(cm.messpunktNr,  own.get(cm.messpunktNr)  + share);
          rest.set(cm.messpunktNr, rest.get(cm.messpunktNr) - share);
        });
        p -= supply;
      }
      pool += p;
    });

    // Stufe 2 – Rest proportional aus dem vZEV-Pool.
    const openC   = consList.reduce((s, { m }) => s + rest.get(m.messpunktNr), 0);
    const poolUse = Math.min(pool, openC);

    consList.forEach(({ m, c }) => {
      const fromPool = openC > 0 ? (rest.get(m.messpunktNr) / openC) * poolUse : 0;
      const fromOwn  = own.get(m.messpunktNr);
      const vzev     = fromOwn + fromPool;
      if (!agg[m.messpunktNr][mk]) agg[m.messpunktNr][mk] = { cons: 0, vzev: 0, own: 0, pool: 0, grid: 0, prod: 0 };
      agg[m.messpunktNr][mk].cons += c;
      agg[m.messpunktNr][mk].vzev += vzev;
      agg[m.messpunktNr][mk].own  += fromOwn;
      agg[m.messpunktNr][mk].pool += fromPool;
      agg[m.messpunktNr][mk].grid += c - vzev;
      // Zuteilungsstatistik bezieht sich auf den Pool-Anteil (Stufe 2).
      if (poolUse > 0 && openC > 0) distStats[m.messpunktNr].push((rest.get(m.messpunktNr) / openC) * 100);
    });

    prodMeters.forEach(pm => {
      const sl  = slots[pm.messpunktNr];
      const pmP = sl ? Math.max(sl.bezug, sl.einspeisung) : 0;
      if (!agg[pm.messpunktNr][mk]) agg[pm.messpunktNr][mk] = { cons: 0, vzev: 0, own: 0, pool: 0, grid: 0, prod: 0 };
      agg[pm.messpunktNr][mk].prod += pmP;
    });

    if (!monthly[mk]) monthly[mk] = { cons: 0, vzev: 0, own: 0, pool: 0, grid: 0, prod: 0, sc: 0, fi: 0 };
    monthly[mk].cons += totalC;
    monthly[mk].prod += prod;
    monthly[mk].sc   += sc;
    monthly[mk].fi   += fi;
    monthly[mk].vzev += sc;
    monthly[mk].own  += consList.reduce((s, { m }) => s + own.get(m.messpunktNr), 0);
    monthly[mk].pool += poolUse;
    monthly[mk].grid += totalC - sc;
  });

  // ── Totals ────────────────────────────────────────────────────────────────
  const tot = { cons: 0, vzev: 0, own: 0, pool: 0, grid: 0, prod: 0, sc: 0, fi: 0 };
  Object.values(monthly).forEach(m => {
    tot.cons += m.cons; tot.vzev += m.vzev; tot.grid += m.grid;
    tot.own  += m.own;  tot.pool += m.pool;
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
  const fixed = allocateFixedCosts(agg, meters, tariff, periodStart, periodEnd);
  AppState.lastResult = { agg, monthly, tot, scRate, ssRate, meters, tariff, distStats, periodStart, periodEnd, fixed };

  // ── Render all sections ───────────────────────────────────────────────────
  renderSummary(tot, scRate, ssRate);
  renderMonthly(monthly, tariff, fixed);
  renderMeterAgg(agg, meters, distStats);
  renderCosts(agg, meters, tariff, fixed);
  renderCharts(monthly, consMeters, agg);
  renderDayProfile(byTS, meters);
  renderTimeline(byTS, meters);
  renderOptimisation(byTS, meters);
  renderMethodologyExample(byTS, consMeters, prodMeters);

  document.getElementById('results').classList.remove('hidden');
  setStep(3);
  document.getElementById('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
