// ── EXPORT ────────────────────────────────────────────────────────────────────

function exportCSV() {
  const rows = [];
  document.querySelectorAll('#monthlyTable tr').forEach(tr => {
    rows.push(
      [...tr.querySelectorAll('th,td')]
        .map(td => '"' + td.innerText.replace(/\n/g, ' ').replace(/"/g, '""') + '"')
        .join(';')
    );
  });
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `vZEV_Auswertung_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}
