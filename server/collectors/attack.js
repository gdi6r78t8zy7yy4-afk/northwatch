// MITRE ATT&CK (Enterprise) – ramverkets version + innehållsantal.
// STIX-bundlet (master) hämtas från GitHub raw (~55 MB) med ETag-cache
// (304 → föregående tal återanvänds). Typantal räknas med regex på råtexten;
// ett fullständigt JSON.parse kräver flera GB heap och undviks medvetet.
// Versionen hämtas från GitHub releases (1 anrop/vecka – väl inom rate-limit).
import { now } from '../lib/http.js';

const RAW_URL = process.env.ATTACK_RAW_URL ||
  'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json';
const REL_URL = 'https://api.github.com/repos/mitre-attack/attack-stix-data/releases/latest';

let etag = null;
let lastRecords = [];

const countType = (text, type) =>
  (text.match(new RegExp(`"type"\\s*:\\s*"${type}"`, 'g')) ?? []).length;

export default {
  id: 'attack',
  name: 'MITRE ATT&CK',
  area: 5,
  country: 'NORDIC',
  every: 604800,
  fetch: async () => {
    const res = await fetch(RAW_URL, {
      headers: {
        'User-Agent': 'northwatch/0.1',
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
      signal: AbortSignal.timeout(180000),
    });
    if (res.status === 304 && lastRecords.length) return lastRecords;
    if (!res.ok) throw new Error(`HTTP ${res.status} raw.githubusercontent.com`);
    const newEtag = res.headers.get('etag');
    if (newEtag) etag = newEtag;
    const text = await res.text();

    let version = '';
    try {
      const rel = await (await fetch(REL_URL, {
        headers: { 'User-Agent': 'northwatch/0.1' },
        signal: AbortSignal.timeout(20000),
      })).json();
      version = rel.tag_name ?? '';
    } catch {
      /* version okänd – ej kritiskt */
    }

    const counts = [
      ['Enterprise-tekniker', countType(text, 'attack-pattern')],
      ['Hotgrupper (intrusion sets)', countType(text, 'intrusion-set')],
      ['Skadlig kod (malware)', countType(text, 'malware')],
      ['Verktyg (tools)', countType(text, 'tool')],
      ['Kampanjer (campaigns)', countType(text, 'campaign')],
      ['Mitigeringar (course of action)', countType(text, 'course-of-action')],
    ];
    const records = counts.map(([name, value]) => ({
      t: 'm', area: 5, country: 'NORDIC', source: 'attack',
      indicator: `ATT&CK ${name}`, value, unit: 'st', ts: now(),
    }));
    if (version) records.push({
      t: 'e', area: 5, country: 'NORDIC', source: 'attack',
      kind: 'uppdatering', severity: 'info',
      title: `MITRE ATT&CK version ${version}`,
      detail: `${counts[0][1]} tekniker i Enterprise-matrisen (STIX-bundel ${Math.round(text.length / 1e6)} MB).`,
      start: now(),
    });
    lastRecords = records;
    return records;
  },
};
