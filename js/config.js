// ── KNOWN METERS ─────────────────────────────────────────────────────────────
// Pre-configured meter points for Ogimatte, Reichenbach im Kandertal.
// When a file is uploaded, meters matching these IDs are auto-filled.

const KNOWN = [
  {
    messpunktNr: 'CH1022201234500000000000000092766',
    zaehlerNr:   '10781966',
    typ:         'Verbrauch',
    priority:    false,
    label:       'Ogimatte 10',
    adresse:     'Ogimatte 10, 3713 Reichenbach im Kandertal'
  },
  {
    messpunktNr: 'CH1022201234500000000000000524698',
    zaehlerNr:   '10754964',
    typ:         'Verbrauch',
    priority:    true,
    label:       'Ogimatte 7 (Verbrauch)',
    adresse:     'Ogimatte 7, 3713 Reichenbach im Kandertal'
  },
  {
    messpunktNr: 'CH1022201234500000000000000524699',
    zaehlerNr:   '10754964',
    typ:         'Produktion',
    priority:    false,
    label:       'Ogimatte 7 (Solar)',
    adresse:     'Ogimatte 7, 3713 Reichenbach im Kandertal'
  }
];
