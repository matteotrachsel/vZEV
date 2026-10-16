// ── BKW-TARIFE AUS DER ÖFFENTLICHEN JSON-DATEI ────────────────────────────────
// Quelle: https://www.bkw.ch/fileadmin/user_upload/tarife-json.json
// Die Datei enthält alle Tarifbausteine der BKW (exkl. MWSt.) für das laufende
// und – sobald publiziert – das folgende Jahr. Für die vZEV-Abrechnung werden
// daraus pro Jahr die Werte gebildet, die im Tool eingegeben werden:
//   Einheitstarif  = (Energie + Netznutzung) × (1 + MWSt.)        Rp./kWh
//   Grundtarif     = (Grundpreis Energie + Netz + Messung) × 12 × (1 + MWSt.)  CHF/Jahr
//   Konzession     = Konzessionsabgabe der Gemeinde               Rp./kWh
// Unterscheiden sich die Tarife innerhalb eines Jahres (mehrere Einträge),
// wird der Eintrag genommen, der am 1. Januar gilt.

const SOURCE_URL = 'https://www.bkw.ch/fileadmin/user_upload/tarife-json.json';

const DEFAULTS = {
  product:      'Energy Blue',                         // Energieprodukt (tariffType "electricity")
  gridTariff:   'Einheitstarif',                       // Netznutzung (tariffType "grid")
  metering:     'Niederspannung ohne Wandlermessung',  // Messtarif (tariffType "metering")
  voltageLevel: 7,                                     // Netzebene 7 = Niederspannung
  municipality: 15143,                                 // BKW-Gemeindenummer: Reichenbach im Kandertal
  vat:          0.081                                  // MWSt.-Satz Schweiz seit 2024
};

const yearOf = s => parseInt(String(s).slice(0, 4), 10);
const round  = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

// Nur konstante Tarife (ein Preis rund um die Uhr) sind für den Einheitstarif geeignet.
const flatEnergy = t => {
  const e = t.prices?.energy;
  return Array.isArray(e) && e.length === 1 ? e[0].price : null;
};

function extractTariffs(json, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const all = Array.isArray(json?.tariffs) ? json.tariffs : [];
  const years = [...new Set(all.map(t => yearOf(t.startDate)).filter(Number.isFinite))].sort();
  const out = {};

  for (const year of years) {
    const inYear = all.filter(t => yearOf(t.startDate) === year);
    const one = (pred, what) => {
      const hits = inYear.filter(pred);
      if (!hits.length) throw new Error(`${year}: ${what} nicht gefunden`);
      return hits[0];
    };

    try {
      const energy = one(t => t.tariffType === 'electricity' && t.tariffName === o.product && flatEnergy(t) != null,
        `Energieprodukt "${o.product}"`);
      const grid = one(t => t.tariffType === 'grid' && t.tariffName.startsWith(o.gridTariff)
        && +t.customerVoltageLevel === o.voltageLevel && flatEnergy(t) != null, `Netztarif "${o.gridTariff}"`);
      const meter = one(t => t.tariffType === 'metering' && t.tariffName.startsWith(o.metering)
        && +t.customerVoltageLevel === o.voltageLevel, `Messtarif "${o.metering}"`);

      // Konzessionsabgabe der Gemeinde – Einträge für Zweitzähler ausschliessen.
      let konz = null;
      for (const t of inYear) {
        if (t.tariffType !== 'regional_fees' || +t.customerVoltageLevel !== o.voltageLevel) continue;
        if (/zweitz/i.test(t.tariffName) || /zweitz/i.test(t.comment || '')) continue;
        for (const m of t.prices?.municipalityTaxes || []) {
          if (+m.municipalityNumber === +o.municipality && /konzession/i.test(t.tariffName)) {
            konz = { price: m.municipalityEnergy?.[0]?.price ?? 0, name: m.municipalityName, comment: m.municipalityComment || '' };
          }
        }
      }

      const energyRp = flatEnergy(energy) * 100;
      const gridRp   = flatEnergy(grid) * 100;
      const baseChfMonth = (energy.prices.base?.price || 0) + (grid.prices.base?.price || 0) + (meter.prices.base?.price || 0);

      out[year] = {
        validFrom: String(energy.startDate).slice(0, 10),
        validTo:   String(energy.endDate).slice(0, 10),
        // Werte, wie sie im Tool eingesetzt werden (inkl. MWSt.)
        energyAllInRp:  round((energyRp + gridRp) * (1 + o.vat), 2),
        grundtarifChfY: round(baseChfMonth * 12 * (1 + o.vat), 2),
        konzessionRp:   konz ? round(konz.price * 100, 2) : null,
        // Bausteine exkl. MWSt. zur Nachvollziehbarkeit
        parts: {
          energyRp: round(energyRp, 4),
          gridRp:   round(gridRp, 4),
          baseChfMonth: {
            energy:   energy.prices.base?.price || 0,
            grid:     grid.prices.base?.price || 0,
            metering: meter.prices.base?.price || 0
          },
          municipality: konz ? `${konz.name} (${o.municipality})` : null,
          vat: o.vat
        }
      };
    } catch (e) {
      out[year] = { error: e.message };
    }
  }

  return {
    source: SOURCE_URL,
    dso: json?.dsoName || '',
    product: o.product,
    years: out
  };
}

module.exports = { extractTariffs, SOURCE_URL, DEFAULTS };
