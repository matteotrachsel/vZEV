// ── KNOWN METERS ─────────────────────────────────────────────────────────────
// Pre-configured meter points for BKW vZEV (1 Produzent, 1 Konsument).
// When a file is uploaded, meters matching these IDs are auto-filled.

const KNOWN = [
  {
    messpunktNr: 'CH1022201234500000000000000092766',
    zaehlerNr:   '10781966',
    typ:         'Verbrauch',
    label:       'Konsument',
    adresse:     ''
  },
  {
    messpunktNr: 'CH1022201234500000000000000524698',
    zaehlerNr:   '10754964',
    typ:         'Verbrauch',
    label:       'Produzent (Verbrauch)',
    adresse:     ''
  },
  {
    messpunktNr: 'CH1022201234500000000000000524699',
    zaehlerNr:   '10754964',
    typ:         'Produktion',
    label:       'Produzent (Solar)',
    adresse:     ''
  }
];
