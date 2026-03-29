// ── HELPERS ──────────────────────────────────────────────────────────────────

function fmt(d) {
  return d.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMonth(mk) {
  const [y, m] = mk.split('-');
  return new Date(+y, +m - 1, 1).toLocaleDateString('de-CH', { month: 'short', year: 'numeric' });
}

function fmtCHF(v) {
  return v.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mkAlert(cls, html) {
  const icons = { ai: 'ℹ', as: '✓', aw: '⚠', ae: '✕' };
  return `<div class="alert ${cls}"><span class="alert-icon">${icons[cls]}</span><span>${html}</span></div>`;
}
