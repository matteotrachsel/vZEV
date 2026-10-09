// ── VERSION ───────────────────────────────────────────────────────────────────
// Zeigt an, wann die laufende Version deployt wurde (version.json wird beim
// Vercel-Build von scripts/build-version.js erzeugt). Fehlt die Datei – etwa
// beim lokalen Öffnen –, wird "Lokale Version" angezeigt.

document.addEventListener('DOMContentLoaded', async () => {
  const badge  = document.getElementById('versionBadge');
  const footer = document.getElementById('versionFooter');
  if (!badge || !footer) return;

  let v = null;
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (res.ok) v = await res.json();
  } catch (e) { /* file:// oder offline */ }

  if (!v?.builtAt) {
    // Lokal geöffnet oder auf einem Hosting ohne Build-Schritt (z. B. GitHub Pages).
    const local = location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    const label = local ? 'Lokale Version' : 'Stand unbekannt';
    badge.textContent  = label;
    badge.title        = 'Kein Deployment-Stand verfügbar (version.json fehlt).';
    footer.textContent = label;
    return;
  }

  const d = new Date(v.builtAt);
  const opts = { timeZone: 'Europe/Zurich' };
  const date = d.toLocaleDateString('de-CH', { ...opts, day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = d.toLocaleTimeString('de-CH', { ...opts, hour: '2-digit', minute: '2-digit' });
  const preview = v.env && v.env !== 'production';

  const envLabel = { preview: 'Vorschau', development: 'Entwicklung', local: 'lokal' }[v.env] || v.env;
  badge.textContent = `Stand ${date}${preview ? ' · ' + envLabel : ''}`;
  badge.classList.toggle('preview', !!preview);
  badge.title = [
    `Deployt am ${date} um ${time} Uhr`,
    v.commit  && `Commit ${v.commit}${v.branch ? ' (' + v.branch + ')' : ''}`,
    v.message && v.message
  ].filter(Boolean).join('\n');

  footer.textContent = `Version vom ${date}, ${time} Uhr` + (v.commit ? ` · ${v.commit}` : '');
});
