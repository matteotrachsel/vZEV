// ── APP STATE ─────────────────────────────────────────────────────────────────
// Central mutable state. All modules read and write through this object.

const AppState = {
  parsedData:  [],   // array of { messpunkt, datum, bezug, einspeisung }
  detectedMPs: [],   // array of unique messpunktNr strings from the uploaded file
  charts: {
    monthly:    null,   // Chart.js instance – monthly bar chart
    pie:        null,   // Chart.js instance – energy distribution pie
    dist:       null,   // Chart.js instance – monthly vZEV share stacked bar
    dayProfile: null    // Chart.js instance – average daily load profile
  },
  lastResult: null   // last computed vZEV result – used by invoice generator
};
