// DK: Retsinformation (M11, område 12) – ændringer i dansk lovgivning
// (Folketingets lovsamling). https://api.retsinformation.dk – ingen nyckel.
// GET /v1/Documents → senaste 24 h (klippt 03:00); ?date=YYYY-MM-DD → ett
// specifikt datum, max 10 dagar bakåt. Svaret är en BAR JSON-array:
//   [{documentId, accessionsnummer, reasonForChange, changeDate,
//     documentType:{shortName,id}, href, images}]
// Veckodagar: ~100–150 dokument/dag; helger är normalt TOMMA – ett tomt fönster
// är alltså data, inte ett fel (value 0). Kollekturen räknar senaste sju
// dygnen via explicita ?date-anrop (1,2 s takt; standardfönstret "senaste 24 h"
// undviks eftersom det kan överlappa igårs datedata) och räknar per dag
// + per dokumenttyp. Daglig hämtning. 1,2 s takt mellan anropen
// (RTI_DELAY_MS, nollas i tester).
// API:et är instabilt: non-JSON/tom kropp på slumpmässiga datum (verifierat
// live 2026-11-09) → progressiv retry per dag, 3 försök (paus 1,2/2,4 s vid
// standardtakt). Ännu misslyckad dag → "hämtfel"-record, totalt blir delvis.
import { jjson, now, sleep } from '../lib/http.js';

const BASE = 'https://api.retsinformation.dk/v1/Documents';
const DAYS_BACK = 7; // sju dygn → veckotrend för aktivitetspoängen
const MAX_EVENTS = 30; // max händelse-records (nyaste först)

// YYYY-MM-DD (lokal) – sju dagar bakåt inkl. idag.
export const lastNDays = n => {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i += 1) {
    const x = new Date(d.getTime() - i * 86400000);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
};

// Dagsdokument → { n, typer, events } (events: de första MAX_EVENTS).
export function summarizeDay(datum, docs) {
  const typer = {};
  for (const d of docs) typer[d?.documentType?.shortName ?? 'okänd'] = (typer[d?.documentType?.shortName ?? 'okänd'] ?? 0) + 1;
  const events = docs.slice(0, MAX_EVENTS).map(d => ({
    t: 'e', area: 12, country: 'DK', source: 'retsinformation', kind: 'lagtext',
    severity: 'info',
    title: `${d.accessionsnummer ?? d.documentId} (${d.documentType?.shortName ?? '?'})`,
    detail: d.reasonForChange ?? '',
    start: d.changeDate ?? datum,
  }));
  return { n: docs.length, typer, events };
}

export default {
  id: 'retsinformation',
  name: 'Retsinformation (dansk lagändringar)',
  area: 12,
  country: 'DK',
  every: 86400,
  fetch: async () => {
    const ts = now();
    const rec = (indicator, value, tsv) => ({
      t: 'm', area: 12, country: 'DK', source: 'retsinformation',
      indicator, value, unit: 'st', ts: tsv ?? ts,
    });
    const delay = Number(process.env.RTI_DELAY_MS ?? 1200);
    const days = lastNDays(DAYS_BACK);
    const records = [];
    const allEvents = [];
    const typerTotal = {};
    let total = 0;
    const failed = [];

    // Ett ?date=-anrop per dag; dagens data är klippad 03:00.
    const windows = days.map(d => ({ url: `${BASE}?date=${d}`, label: d }));

    for (let i = 0; i < windows.length; i += 1) {
      if (i > 0) await sleep(delay);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const docs = await jjson(windows[i].url);
          const st = summarizeDay(windows[i].label, docs);
          total += st.n;
          for (const [ty, n] of Object.entries(st.typer)) typerTotal[ty] = (typerTotal[ty] ?? 0) + n;
          allEvents.unshift(...st.events);
          records.push(rec(`Lagändringar, ${windows[i].label}`, st.n, windows[i].label));
          break;
        } catch (e) {
          if (attempt < 2) {
            // Instabilt API (non-JSON/tom kropp på slumpmässiga datum) →
            // progressiv paus (1,2/2,4 s vid standardtakt) och nytt försök.
            await sleep(delay * (attempt + 1));
          } else {
            failed.push({ day: windows[i].label, message: e.message });
          }
        }
      }
    }

    if (failed.length === windows.length) {
      throw new Error(`Retsinformation: alla ${failed.length} dagar misslyckades – ${failed[0].message}`);
    }
    for (const f of failed) {
      records.push(rec(`Lagändringar ${f.day}: hämtfel`, null, f.day));
    }

    records.push(rec(`Lagändringar, senaste ${DAYS_BACK} dygn`, total, ts));
    for (const [ty, n] of Object.entries(typerTotal).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
      records.push(rec(`Lagändringar per typ: ${ty} (${DAYS_BACK} d)`, n, ts));
    }
    records.push(...allEvents.slice(0, MAX_EVENTS * DAYS_BACK));
    return records;
  },
};
