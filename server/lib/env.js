// Läser .env från repo-roten (utan att skriva över redan sätta variabler).
// Gör att `node server/app.js` fungerar utan --env-file-flaggan.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
try {
  const txt = fs.readFileSync(path.join(root, '.env'), 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* .env är frivilligt */ }
