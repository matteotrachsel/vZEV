// ── BUILD: version.json ───────────────────────────────────────────────────────
// Läuft als Vercel-Build-Schritt (vercel.json → buildCommand) und hält fest,
// wann und aus welchem Commit die Seite deployt wurde. Die Seite liest die
// Datei in js/version.js und zeigt den Stand in Navigation und Footer an.
// Ohne Abhängigkeiten, damit kein npm install nötig ist.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Bei Deployments per Git-Integration liefert Vercel die Commit-Infos als
// Umgebungsvariablen; bei CLI-Deployments oder lokal fällt es auf git zurück.
const git = cmd => { try { return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };

const commit = process.env.VERCEL_GIT_COMMIT_SHA || git('rev-parse HEAD');
const info = {
  builtAt: new Date().toISOString(),
  commit:  commit ? commit.slice(0, 7) : '',
  branch:  process.env.VERCEL_GIT_COMMIT_REF || git('rev-parse --abbrev-ref HEAD'),
  message: (process.env.VERCEL_GIT_COMMIT_MESSAGE || git('log -1 --pretty=%s')).split('\n')[0].slice(0, 120),
  env:     process.env.VERCEL_ENV || 'local'
};

const out = path.join(__dirname, '..', 'version.json');
fs.writeFileSync(out, JSON.stringify(info, null, 2) + '\n');
console.log('version.json:', JSON.stringify(info));
