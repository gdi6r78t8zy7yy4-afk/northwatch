// FI: Finlex avoindata (M11, område 12) – Finlands lagsättning via AKN-URI:er.
// GET https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute/list
//   ?startYear=Y&endYear=Y&limit=10&page=N
// page är ETTRABASERAD (page=0 → 400 "page must be >= 1"); svaret är en BAR
// array [{akn_uri, status:"NEW"|"MODIFIED"}] UTAN totalt antal → räkna genom
// paginering.
// Samma lag förekommer en gång per språkversion (/fin@ och /swe@) → avdubbla
// på lagenr (statute/<år>/<nr>). 429 = rate limit (fönster efter ~180–200
// snabba anrop) → progressiv backoff, kumulativt 5/15/30 s – fönstret
// öppnas efter ~30 s (verifierat 2026-11-09). Misslyckas en sida ändå
// bevaras det som räknats:
// capped → "(estimat)" (failed bara vid noll data). Sidtak (FINLEX_MAX_PAGES,
// standard 350) → delvis totalt, markeras "(estimat)".
// User-Agent krävs av Finlex. Rättspraxis (HFD/KHO/HS) och HE/AS saknas som
// API – luckan dokumenteras i README M11 och renormaliseras i analysen.
// Veckohämtning: löpande år (YTD) + föregående år jämförelse.
import { j, now, sleep } from '../lib/http.js';

const BASE = 'https://opendata.finlex.fi/finlex/avoindata/v1/akn/fi/act/statute/list';

// akn_uri → lagenr ("2026/869/swe@" → "869").
export const statuteNumber = uri => {
  const m = String(uri ?? '').match(/\/statute\/(\d+)\/(\d+)(?:\/([^/]+))?/);
  return m ? m[2] : null;
};

// Hämtar ett år helt (paginerat). Returnerar {entries, pages, new, modified,
// capped} där new/modified är SETs av unika lagenr.
export async function countYear(year, {
  maxPages = Number(process.env.FINLEX_MAX_PAGES ?? 350),
  delayMs = Number(process.env.FINLEX_DELAY_MS ?? 250),
  backoffMs = Number(process.env.FINLEX_BACKOFF_MS ?? 5000),
} = {}) {
  let page = 1;
  const stat = { entries: 0, pages: 0, new: new Set(), modified: new Set(), capped: false, failed: false };
  while (page <= maxPages) {
    const url = `${BASE}?startYear=${year}&endYear=${year}&limit=10&page=${page}`;
    let arr = null;
    let giveup = false;
    for (let attempt = 0; attempt <= 3; attempt += 1) {
      try {
        const r = await j(url, { timeout: 25000 });
        arr = await r.json();
        break;
      } catch (e) {
        if (/HTTP 429/.test(e.message) && attempt < 3) {
          // Progressiv paus (kumulativt 5/15/30 s vid standard): Finlex:s
          // 429-fönster öppnas efter ~30 s – enbart 5 s räcker inte (live).
          await sleep(backoffMs * (attempt + 1));
          continue;
        }
        giveup = true;
        break;
      }
    }
    if (giveup) {
      // Delvis totalt bevaras som "(estimat)"; failed bara vid noll data.
      stat.capped = true;
      if (!stat.entries) stat.failed = true;
      return stat;
    }
    if (!Array.isArray(arr) || !arr.length) break;
    stat.entries += arr.length;
    for (const e of arr) {
      const nr = statuteNumber(e.akn_uri);
      if (e.status === 'NEW') stat.new.add(nr ?? e.akn_uri);
      else stat.modified.add(nr ?? e.akn_uri);
    }
    stat.pages = page;
    if (arr.length < 10) break;
    page += 1;
    if (delayMs > 0) await sleep(delayMs);
  }
  if (page > maxPages) stat.capped = true;
  return stat;
}

export default {
  id: 'finlex',
  name: 'Finlex (finländsk lagsättning)',
  area: 12,
  country: 'FI',
  every: 604800,
  fetch: async () => {
    const ts = now();
    const year = new Date().getFullYear();
    const rec = (indicator, value, tsv) => ({
      t: 'm', area: 12, country: 'FI', source: 'finlex',
      indicator, value, unit: 'st', ts: tsv ?? ts,
    });
    const records = [];
    const suf = (s, capped) => (capped ? `${s} (estimat)` : s);

    const cur = await countYear(year);
    if (!cur.failed) {
      records.push(
        rec(suf(`Lagversioner ${year}`, cur.capped), cur.entries, String(year)),
        rec(suf(`Nya lagar ${year}`, cur.capped), cur.new.size, String(year)),
        rec(suf(`Ändrade lagar ${year}`, cur.capped), cur.modified.size, String(year)),
      );
    } else {
      records.push(rec(`Finlex ${year}: hämtfel`, null, ''));
    }

    if (!cur.failed) {
      const prev = await countYear(year - 1);
      if (!prev.failed) {
        records.push(
          rec(suf(`Nya lagar ${year - 1} (hela året)`, prev.capped), prev.new.size, String(year - 1)),
          rec(suf(`Ändrade lagar ${year - 1} (hela året)`, prev.capped), prev.modified.size, String(year - 1)),
        );
      } else {
        records.push(rec(`Finlex ${year - 1}: hämtfel`, null, ''));
      }
    }

    if (!records.some(r => r.value != null)) {
      throw new Error(`Finlex: inga lagversioner kunde hämtas (${year} och ${year - 1})`);
    }
    return records;
  },
};
