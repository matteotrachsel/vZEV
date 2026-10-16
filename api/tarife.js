// ── GET /api/tarife ───────────────────────────────────────────────────────────
// Lädt die BKW-Tarifdatei serverseitig (die BKW erlaubt keinen direkten Abruf
// aus dem Browser – kein CORS-Header – und die Datei ist ~1.9 MB gross) und
// liefert nur die für die vZEV-Abrechnung nötigen Werte pro Jahr (~1 KB).
// Vercel cached die Antwort einen Tag; danach wird im Hintergrund erneuert.

const { extractTariffs, SOURCE_URL } = require('./_lib/bkw-tarife');

module.exports = async (req, res) => {
  try {
    const r = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'vZEV-Stromauswertung' } });
    if (!r.ok) throw new Error(`BKW antwortet mit HTTP ${r.status}`);
    const json = await r.json();

    const muni = parseInt(req.query?.gemeinde, 10);
    const data = extractTariffs(json, Number.isFinite(muni) ? { municipality: muni } : {});
    data.lastModified = r.headers.get('last-modified') || null;
    data.fetchedAt    = new Date().toISOString();

    res.setHeader('Cache-Control', 'public, s-maxage=86400, stale-while-revalidate=604800');
    res.status(200).json(data);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: `Tarife konnten nicht geladen werden: ${e.message}` });
  }
};
