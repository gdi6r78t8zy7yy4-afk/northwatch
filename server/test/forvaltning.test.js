// Enhetstester för förvaltningsdatslagret (M11, område 12): sju kollektorer
// (Riksdagen, FDK/DigDir, Retsinformation, Finlex, IPU Parline, data.europa.eu,
// EUR-Lex/Cellar) + den beräknande analysen lib/forvaltning.js (Förvaltningsindex).
// Inget nätverk – globalThis.fetch mockas per URL mot fixtures i
// testdata/forvaltning/ (formverifierade mot live-API:na 2026-11-08 med
// synthetiska värden). Riksdagens zip-flöden byggs i minnet med en minimal
// ZIP-skribent (store + deflate) som matchar lib/zip.js-parsarn. Riktiga tal
// beräknas ur fixtures; indexpoäng i förvaltningStatus är regressionsankrar.
// Klockberoende anspråk (riksdagens kommande händelser, dagar sedan senaste
// val, finlex löpande år) hanteras dynamiskt ur fixtures + today.
//
// Kör: node --test server/test/forvaltning.test.js
//
// Miljön sätts INNAN import: alla rate-limitpausar nollas (FDK_DELAY_MS,
// IPU_DELAY_MS, DATAPORTAL_DELAY_MS, CELLAR_DELAY_MS, FINLEX_DELAY_MS,
// FINLEX_BACKOFF_MS, RTI_DELAY_MS) och FINLEX_MAX_PAGES sätts till 50
// (räcker till fixtures 38+17 poster = 6 sidor).
process.env.FDK_DELAY_MS = '0';
process.env.IPU_DELAY_MS = '0';
process.env.DATAPORTAL_DELAY_MS = '0';
process.env.CELLAR_DELAY_MS = '0';
process.env.FINLEX_DELAY_MS = '0';
process.env.FINLEX_BACKOFF_MS = '0';
process.env.FINLEX_MAX_PAGES = '50';
process.env.RTI_DELAY_MS = '0';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const TESTDATA = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'testdata', 'forvaltning');
const rd = f => fs.readFileSync(path.join(TESTDATA, f), 'utf8');
const rj = f => JSON.parse(rd(f));

const fdkFx = rj('fdk.json');
const rtiFx = rj('rti-days.json');
const finCur = rj('finlex-cur.json');
const finPrev = rj('finlex-prev.json');
const ipuFx = rj('ipu.json');
const dpFx = rj('dataportal.json');
const cellarFx = rj('cellar.json');

// ---- Minimal ZIP-skribent (i minnet) – samma form Riksdagens zips har -------
// Lokal header + central directory + EOCD; metod 0 (store) eller 8 (deflate),
// UTF-8-namnsflagg (0x800). Exakt det som server/lib/zip.js parsar.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// files: [{ name, data: Buffer|string, method?: 0|8 }] → zip-Buffer.
const makeZip = files => {
  const d = new Date(2026, 10, 9); // DOS-tid (1980+); parsern läser den ej
  const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const dataBuf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const method = f.method ?? 0;
    const stored = method === 0 ? dataBuf : zlib.deflateRawSync(dataBuf);
    const crc = crc32(dataBuf);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); // lokal header-signatur
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8-namn
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(dosDate, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(stored.length, 18);
    lh.writeUInt32LE(dataBuf.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); // central directory-signatur
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(stored.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    // extra/comment/disk/attribut = 0 (default)
    cd.writeUInt32LE(offset, 42);
    parts.push(lh, nameBuf, stored);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + stored.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD-signatur
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  parts.push(cdBuf, eocd);
  return Buffer.concat(parts);
};

// ---- Mockad fetch per URL → fixture ------------------------------------------
let zips = {}; // byggs i before(): { votering, anforande, person }
let failCurrentVotering = false; // 404 på aktuella kammarårst zips (fallback-test)
let riksdagenDown = false; // alla riksdagen-URL:er 404 (totalsykt-test)
let finlex429 = null; // {page, times} – 429 på givna sidan, times gånger (Infinity = ihållande)
let rtiFail = null; // {day, times} – 503 på givet datum, times gånger (Infinity = ihållande)
const calls = []; // {url, method} – sparas för anropsräknings-anspråk

const realFetch = globalThis.fetch;
const bufToAb = buf => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
globalThis.fetch = (url, opt = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opt?.method ?? 'GET' });
  const ok = (obj, buf) => ({
    ok: true, status: 200,
    json: async () => obj,
    text: async () => JSON.stringify(obj ?? {}),
    arrayBuffer: async () => (buf ? bufToAb(buf) : new ArrayBuffer(0)),
  });
  const notFound = () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' });
  let m;

  // Riksdagen: kalender (JSON) + tre dataset-zips.
  if (riksdagenDown) {
    if (u.startsWith('https://data.riksdagen.se/')) return notFound();
  }
  if (u.startsWith('https://data.riksdagen.se/kalender/')) return ok(rj('riksdagen-kalender.json'));
  if ((m = u.match(/data\.riksdagen\.se\/dataset\/(votering|anforande)\/\1-(\d{6})\.json\.zip/))) {
    const ar = m[2];
    const cur = kammarAr();
    const prev = `${Number(cur.slice(0, 4)) - 1}${String(Number(cur.slice(0, 4)) - 1).slice(2)}`;
    if (ar !== cur && ar !== prev) return notFound();
    if (failCurrentVotering && ar === cur && m[1] === 'votering') return notFound();
    return ok(null, zips[m[1]]);
  }
  if (u.endsWith('/dataset/person/person.json.zip')) return ok(null, zips.person);

  // FDK: POST /search/datasets – routa på filter.
  if (u.startsWith('https://search.api.fellesdatakatalog.digdir.no/search/datasets')) {
    const body = JSON.parse(opt?.body ?? '{}');
    const f = body.filters ?? {};
    const doc = f.lastXDaysModified === 365 ? fdkFx.m365
      : f.lastXDaysModified === 30 ? fdkFx.m30
      : f.lastXDays === 365 ? fdkFx.n365
      : fdkFx.base;
    return ok(doc);
  }

  // Retsinformation: GET ?date=YYYY-MM-DD – samma 7-dagarsfönstret som kollektorn.
  if (u.startsWith('https://api.retsinformation.dk/v1/Documents')) {
    const d = new URL(u).searchParams.get('date');
    const days = lastNDays(7);
    const i = days.indexOf(d);
    if (i < 0) throw new Error(`fetch-mock: oväntat RTI-datum ${d}`);
    if (rtiFail && d === rtiFail.day && rtiFail.times > 0) {
      rtiFail.times -= 1;
      return { ok: false, status: 503, json: async () => ({}), text: async () => '' };
    }
    return ok(rtiFx[i]);
  }

  // Finlex: bar array per sida; routa på startYear (löpande/föregående).
  if (u.startsWith('https://opendata.finlex.fi/')) {
    const p = new URL(u).searchParams;
    const year = Number(p.get('startYear'));
    const page = Number(p.get('page'));
    if (finlex429 && page === finlex429.page && finlex429.times > 0) {
      finlex429.times -= 1;
      return { ok: false, status: 429, json: async () => ({}), text: async () => '' };
    }
    const curYear = new Date().getFullYear();
    const flat = year === curYear ? finCur : year === curYear - 1 ? finPrev : null;
    if (!flat) throw new Error(`fetch-mock: oväntat Finlex-år ${year}`);
    return ok(flat.slice((page - 1) * 10, page * 10));
  }

  // IPU: filter=<fält>:<op>:<värde>; ruta på endpoint + land.
  if (u.startsWith('https://api.data.ipu.org/v1/')) {
    const p = new URL(u).searchParams;
    const filter = p.get('filter') ?? '';
    const name = u.split('?')[0].split('/').pop();
    const cc = (filter.match(/(?:id|chamber):eq:([A-Z]{2})(?:-LC01)?/)
      ?? filter.match(/political_party_country:eq:([A-Z]{2})/))?.[1];
    const key = name === 'parliaments' ? 'parliament'
      : name === 'chambers' ? 'chamber'
      : name === 'elections' ? 'elections'
      : 'parties';
    const entry = cc ? ipuFx[cc]?.[key] : null;
    return entry ? ok(entry) : notFound();
  }

  // data.europa.eu: countOnly (total/minDate) eller limit=3 (urval).
  if (u.startsWith('https://data.europa.eu/api/hub/search/search')) {
    const p = new URL(u).searchParams;
    const d = dpFx[JSON.parse(p.get('facets')).country[0]];
    if (p.get('minDate')) return ok({ result: { index: 0, count: d.recent } });
    if (p.get('limit')) return ok({ result: { index: 0, count: d.samples.length, results: d.samples } });
    return ok({ result: { index: 0, count: d.total } });
  }

  // EUR-Lex/Cellar: POST SPARQL – decode query= och läsa CELEX-prefixet.
  if (u.startsWith('https://publications.europa.eu/webapi/rdf/sparql')) {
    const q = decodeURIComponent(String(opt?.body ?? '').replace(/^query=/, ''));
    const cm = q.match(/REGEX\(\?celex, "\^(3\d{4})([A-Z]?)"\)/);
    if (!cm) throw new Error('fetch-mock: oväntad SPARQL-fråga');
    if (cm[1] !== `3${new Date().getFullYear()}`) throw new Error(`fetch-mock: oväntat CELEX-år ${cm[1]}`);
    const n = cm[2] === '' ? cellarFx.total : cellarFx[cm[2]];
    return ok({ results: { bindings: [{ count: { type: 'literal', value: String(n) } }] } });
  }

  throw new Error('fetch-mock: oväntad URL ' + u);
};
after(() => { globalThis.fetch = realFetch; });

// ---- Importer (efter env-uppsättningen) ---------------------------------------
const rikCol = (await import('../collectors/riksdagen.js')).default;
const { kammarAr, icalDate, kalenderEvents, voteringStats, personStats } = await import('../collectors/riksdagen.js');
const fdkCol = (await import('../collectors/fdk.js')).default;
const { openDataShare } = await import('../collectors/fdk.js');
const rtiCol = (await import('../collectors/retsinformation.js')).default;
const { lastNDays, summarizeDay } = await import('../collectors/retsinformation.js');
const finCol = (await import('../collectors/finlex.js')).default;
const { statuteNumber, countYear } = await import('../collectors/finlex.js');
const ipuCol = (await import('../collectors/ipu.js')).default;
const { lastVal, dateOf, NORDIC5 } = await import('../collectors/ipu.js');
const dpCol = (await import('../collectors/dataportal.js')).default;
const { titleOf, HUB_COUNTRIES } = await import('../collectors/dataportal.js');
const cellarCol = (await import('../collectors/cellar.js')).default;
const { unzip, unzipJson } = await import('../lib/zip.js');
const { forvaltningStatus, forvaltningData, labelOf, NORDIC, WEIGHTS } = await import('../lib/forvaltning.js');
const { now } = await import('../lib/http.js');

const COLS = {
  riksdagen: rikCol, fdk: fdkCol, retsinformation: rtiCol, finlex: finCol,
  ipu: ipuCol, dataportal: dpCol, cellar: cellarCol,
};

const colRecs = {};
let sources; // {id, name, country, every, records, ...} per källa (api-shape)
let allRecs;

before(async () => {
  // Bygg Riksdagens zips i minnet: en fil per omröstning/anförande/person.
  // Varje metod övas: votering + person deflate (8), anförande store (0).
  zips = {
    votering: makeZip(rj('riksdagen-votering.json').map((d, i) => (
      { name: `votering-${String(i + 1).padStart(4, '0')}.json`, data: JSON.stringify(d), method: 8 }))),
    anforande: makeZip(rj('riksdagen-anforande.json').map((d, i) => (
      { name: `anforande-${String(i + 1).padStart(4, '0')}.json`, data: JSON.stringify(d), method: 0 }))),
    person: makeZip(rj('riksdagen-person.json').map((p, i) => (
      { name: `person-${String(i + 1).padStart(4, '0')}.json`, data: JSON.stringify(p), method: 8 }))),
  };
  for (const col of Object.values(COLS)) {
    colRecs[col.id] = await col.fetch();
  }
  sources = Object.values(COLS).map(c => ({
    id: c.id, name: c.name, country: c.country, every: c.every,
    status: 'ok', records: colRecs[c.id],
  }));
  allRecs = Object.values(colRecs).flat();
});

// ---- Förväntade värden härledda ur fixtures (inte hårdkodade) -----------------
const round1 = v => Math.round(v * 10) / 10;
const today = new Date().toISOString().slice(0, 10);
const kalEvents = kalenderEvents(rj('riksdagen-kalender.json').kalenderlista.kalender);
// Händelser senare än i dag: medan minst en finns (till 2026-11-25) är SE:s
// kontinuitet 100 (SE 82); efter att alla passerat sätter riksdagen 0.2 → 76.
const futureCount = kalEvents.filter(e => e.start > today).length;
const seKont = futureCount > 0 ? 100 : 80;
const seScore = futureCount > 0 ? 82 : 76;
// Senaste valet inom 7 år (IPU:s kontinuitetströskel) – fixtures stabila till ~2029.
const ELECTION_MAX = { SE: '2022-09-18', NO: '2021-09-13', DK: '2022-11-13', FI: '2023-04-02', IS: '2024-09-15' };
const daysSince = iso => Math.floor((Date.parse(now()) - Date.parse(iso)) / 86400000);

// ---- Renfunktioner --------------------------------------------------------------
describe('renfunktioner', () => {
  test('kammarAr: sep–dec → aktuell period, jan–aug → föregående', () => {
    assert.equal(kammarAr(new Date(2026, 8, 1)), '202627'); // sept 1
    assert.equal(kammarAr(new Date(2026, 10, 9)), '202627'); // nov 9
    assert.equal(kammarAr(new Date(2026, 11, 31)), '202627'); // dec 31
    assert.equal(kammarAr(new Date(2027, 0, 15)), '202627'); // jan 15 2027
    assert.equal(kammarAr(new Date(2026, 7, 31)), '202526'); // aug 31
    assert.equal(kammarAr(new Date(2026, 0, 15)), '202526'); // jan 15 2026
  });

  test('icalDate: iCal-datum → naivt ISO', () => {
    assert.equal(icalDate('20260928T090000'), '2026-09-28T09:00:00');
    assert.equal(icalDate('20261110T143000'), '2026-11-10T14:30:00');
    assert.equal(icalDate('garbage'), null);
    assert.equal(icalDate(null), null);
  });

  test('kalenderEvents: kalender → event-records, utan DTSTART filtreras', () => {
    assert.equal(kalEvents.length, 6);
    assert.equal(kalEvents[0].title, 'Söndagar (provisorisk)');
    assert.equal(kalEvents[0].start, '2026-09-15T10:00:00');
    assert.equal(kalEvents[0].end, '2026-09-15T11:00:00');
    assert.equal(kalEvents[0].detail, 'Söndagar · Riksdagshuset');
    assert.equal(kalEvents[0].country, 'SE');
    assert.equal(kalEvents[0].source, 'riksdagen');
    assert.equal(kalEvents[0].kind, 'kammarkalender');
    assert.equal(kalenderEvents([]).length, 0);
    assert.equal(kalenderEvents(null).length, 0);
    assert.equal(kalenderEvents([{ SUMMARY: 'Ingen tid' }]).length, 0);
  });

  test('voteringStats: omröstningar + röster per inställning', () => {
    const st = voteringStats(rj('riksdagen-votering.json'));
    assert.deepEqual(st, {
      omrosten: 3,
      rost: { Ja: 9, Nej: 6, Frånvarande: 3, Avstått: 1 },
      rasts: 19,
    });
    assert.equal(voteringStats([]).omrosten, 0);
    assert.equal(voteringStats([{ oannat: {} }]).omrosten, 0); // utan votering → ignoreras
  });

  test('personStats: tjänstgörande ledamöter + könsfördelning', () => {
    const st = personStats(rj('riksdagen-person.json'));
    assert.deepEqual(st, { totalt: 10, tjanstgorande: 6, kvinnor: 3, man: 3 });
  });

  test('makeZip/unzip: store + deflate, ASCII + UTF-8-namn', () => {
    const z = makeZip([
      { name: 'a.json', data: '{"x":1}', method: 0 },
      { name: 'böm-ä.json', data: '{"y":[1,2]}', method: 8 },
    ]);
    const entries = unzip(z);
    assert.deepEqual(entries.map(e => e.name), ['a.json', 'böm-ä.json']);
    assert.equal(entries[0].data.toString('utf8'), '{"x":1}');
    assert.equal(entries[1].data.toString('utf8'), '{"y":[1,2]}');
    assert.deepEqual(unzipJson(z), [{ x: 1 }, { y: [1, 2] }]);
    assert.throws(() => unzip(Buffer.from('inte en zip')), /EOCD/);
  });

  test('openDataShare: andel öppna dataset (0–1)', () => {
    assert.equal(openDataShare(fdkFx.base.aggregations), 9101 / 9227);
    assert.equal(openDataShare({ openData: [] }), null);
    assert.equal(openDataShare({}), null);
    assert.equal(openDataShare({ openData: [{ key: 'true', count: 0 }, { key: 'false', count: 0 }] }), null);
  });

  test('summarizeDay: antal + typer + events (start = önskad dag utan changeDate)', () => {
    const st = summarizeDay('2026-11-09', rtiFx[1]);
    assert.equal(st.n, 6);
    assert.deepEqual(st.typer, { BEK: 2, LBK: 1, VEJ: 1, LOV: 1, SØF: 1 });
    assert.equal(st.events.length, 6);
    assert.equal(st.events[0].title, '2026-11-05 (BEK)');
    assert.equal(st.events[0].start, '2026-11-09');
    assert.equal(st.events[0].country, 'DK');
    assert.equal(st.events[0].source, 'retsinformation');
  });

  test('lastNDays: idag bakåt n dagar (ISO-datum)', () => {
    const days = lastNDays(3);
    assert.equal(days.length, 3);
    assert.equal(days[0], today);
    assert.equal(days[1], new Date(Date.now() - 86400000).toISOString().slice(0, 10));
    assert.equal(days[2], new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10));
  });

  test('statuteNumber: AKN-URI → lagenr', () => {
    assert.equal(statuteNumber('http://data.finlex.fi/fi/act/statute/2026/869/swe@'), '869');
    assert.equal(statuteNumber('http://data.finlex.fi/fi/act/statute/2026/869/fin@'), '869');
    assert.equal(statuteNumber('http://data.finlex.fi/fi/act/statute/2026/869'), '869');
    assert.equal(statuteNumber('saknas'), null);
    assert.equal(statuteNumber(null), null);
  });

  test('lastVal: sist icke-nulla värde i tidsserie', () => {
    assert.equal(lastVal([{ value: 1 }, { value: 2 }]), 2);
    assert.equal(lastVal([{ value: null }, { value: 5 }]), 5);
    assert.equal(lastVal([{ value: 3 }]), 3);
    assert.equal(lastVal([]), null);
    assert.equal(lastVal(null), null);
  });

  test('dateOf: ISO-datum ur värde/objekt', () => {
    assert.equal(dateOf('2022-09-18T12:00:00Z'), '2022-09-18');
    assert.equal(dateOf({ from: '2022-09-18' }), '2022-09-18');
    assert.equal(dateOf('2022-09-18'), '2022-09-18');
    assert.equal(dateOf('okänt'), null);
    assert.equal(dateOf(null), null);
  });

  test('titleOf: lokaliserad titel (mappa eller sträng)', () => {
    assert.equal(titleOf({ title: { sv: 'Svensk', en: 'English' } }), 'Svensk');
    assert.equal(titleOf({ title: { en: 'English only' } }), 'English only');
    assert.equal(titleOf({ title: 'Sträng titel' }), 'Sträng titel');
    assert.equal(titleOf({}), null);
    assert.equal(titleOf(null), null);
  });

  test('labelOf: tröskellabels', () => {
    assert.equal(labelOf(null), 'Okänt');
    assert.equal(labelOf(100), 'Hög trygghet');
    assert.equal(labelOf(75), 'Hög trygghet');
    assert.equal(labelOf(74.9), 'Stabilt');
    assert.equal(labelOf(55), 'Stabilt');
    assert.equal(labelOf(54.9), 'Uppmärksamhet');
    assert.equal(labelOf(35), 'Uppmärksamhet');
    assert.equal(labelOf(34.9), 'Svag');
    assert.equal(labelOf(0), 'Svag');
  });
});

// ---- Kollektorer mot fixtures ---------------------------------------------------
describe('kollektorer (mock)', () => {
  test('riksdagen: 6 events + 10 metrics', () => {
    const recs = colRecs.riksdagen;
    const st = voteringStats(rj('riksdagen-votering.json'));
    assert.equal(recs.length, 6 + 6 + Object.keys(st.rost).length); // 6 händelser + 6 fasta metrics + röster
    const byInd = i => recs.find(r => r.indicator === i);
    const ar = kammarAr();
    assert.equal(byInd('Kalenderhändelser, kammarkalendern')?.value, 6);
    assert.equal(byInd(`Omröstningar (kammaråret ${ar})`)?.value, 3);
    assert.equal(byInd('Röster: Ja')?.value, 9);
    assert.equal(byInd('Röster: Frånvarande')?.value, 3);
    assert.equal(byInd(`Anföranden (kammaråret ${ar})`)?.value, 5);
    assert.equal(byInd('Tjänstgörande riksdagsledamöter')?.value, 6);
    assert.equal(byInd('Kvinnor bland tjänstgörande ledamöter')?.value, 3);
    assert.equal(byInd('Personregister (historiskt)')?.value, 10);
    assert.equal(recs.filter(r => r.t === 'e').length, 6);
    assert.ok(recs.every(r => r.country === 'SE' && r.source === 'riksdagen'));
  });

  test('riksdagen: 404 på aktuellt kammarår → föregående zip', async () => {
    failCurrentVotering = true;
    try {
      const cur = kammarAr();
      const prevAr = `${Number(cur.slice(0, 4)) - 1}${String(Number(cur.slice(0, 4)) - 1).slice(2)}`;
      const recs = await rikCol.fetch();
      assert.equal(recs.find(r => r.indicator === `Omröstningar (kammaråret ${prevAr})`)?.value, 3);
      // Övriga flöden påverkade inte.
      assert.equal(recs.find(r => r.indicator === 'Kalenderhändelser, kammarkalendern')?.value, 6);
    } finally {
      failCurrentVotering = false;
    }
  });

  test('riksdagen: alla 4 flöden nere → källefel', async () => {
    riksdagenDown = true;
    try {
      await assert.rejects(rikCol.fetch(), /alla 4 flöden misslyckades/);
    } finally {
      riksdagenDown = false;
    }
  });

  test('fdk: 6 records (totalt/öppna/≤365 d/≤30 d)', () => {
    const recs = colRecs.fdk;
    assert.equal(recs.length, 6);
    const byInd = i => recs.find(r => r.indicator === i);
    assert.equal(byInd('Dataset i Felles datakatalog')?.value, 9227);
    assert.equal(byInd('Öppna dataset (allmän åtkomst)')?.value, 9101);
    assert.equal(byInd('Öppna dataset (andel)')?.value, 98.6);
    assert.equal(byInd('Dataset med uppdaterad metadata (≤365 d)')?.value, 8768);
    assert.equal(byInd('Nyregistrerade dataset (≤365 d)')?.value, 799);
    assert.equal(byInd('Dataset med metadataändring (≤30 d)')?.value, 1);
    assert.ok(recs.every(r => r.country === 'NO' && r.source === 'fdk'));
  });

  test('retsinformation: 7 dagsrecords + 7d-total + typer + events', () => {
    const recs = colRecs.retsinformation;
    const days = lastNDays(7);
    const sizes = rtiFx.map(d => d.length);
    const total = sizes.reduce((s, n) => s + n, 0);
    const types = new Set(rtiFx.flat().map(d => d.documentType.shortName));
    assert.equal(recs.length, 7 + 1 + types.size + total); // 7 dagar + total + typer + events
    const byInd = i => recs.find(r => r.indicator === i);
    days.forEach((d, i) => assert.equal(byInd(`Lagändringar, ${d}`)?.value, sizes[i]));
    assert.equal(byInd(`Lagändringar, senaste 7 dygn`)?.value, total);
    assert.equal(byInd('Lagändringar per typ: BEK (7 d)')?.value, 9);
    assert.equal(byInd('Lagändringar per typ: SØF (7 d)')?.value, 1);
    assert.equal(recs.filter(r => r.t === 'e').length, total);
    assert.ok(recs.every(r => r.country === 'DK' && r.source === 'retsinformation'));
  });

  test('retsinformation: tillfälligt 503 → progressiv retry, fullt totalt utan hämtfel', async () => {
    const day = lastNDays(7)[1]; // gårdagen
    const days = lastNDays(7);
    const fullTotal = rtiFx.reduce((s, d) => s + d.length, 0);
    rtiFail = { day, times: 2 }; // två missar, tredje försöket lyckas
    try {
      const before = calls.filter(c => c.url.includes('api.retsinformation.dk')).length;
      const recs = await rtiCol.fetch();
      const byInd = i => recs.find(r => r.indicator === i);
      assert.equal(byInd(`Lagändringar, ${day}`)?.value, rtiFx[1].length);
      assert.ok(!recs.some(r => r.t === 'm' && r.indicator.includes('hämtfel')));
      assert.equal(byInd(`Lagändringar, senaste 7 dygn`)?.value, fullTotal);
      // Tre anrop mot det instabila datumet, ett mot övriga sex.
      const rtiCalls = calls.filter(c => c.url.includes('api.retsinformation.dk')).length;
      assert.equal(rtiCalls - before, days.length + 2);
    } finally {
      rtiFail = null;
    }
  });

  test('retsinformation: ihållande 503 → hämtfel-record, delvis totalt (källan ej failed)', async () => {
    const day = lastNDays(7)[2];
    const days = lastNDays(7);
    const partialTotal = rtiFx.reduce((s, d, i) => s + (i === 2 ? 0 : d.length), 0);
    rtiFail = { day, times: Infinity };
    try {
      const before = calls.filter(c => c.url.includes('api.retsinformation.dk')).length;
      const recs = await rtiCol.fetch();
      const byInd = i => recs.find(r => r.indicator === i);
      assert.equal(byInd(`Lagändringar ${day}: hämtfel`)?.value, null);
      assert.equal(recs.filter(r => r.t === 'm' && r.indicator.includes('hämtfel')).length, 1);
      assert.equal(byInd(`Lagändringar, ${day}`), undefined);
      assert.equal(byInd(`Lagändringar, senaste 7 dygn`)?.value, partialTotal);
      // Tre försök mot det sjuka datumet, ett mot övriga sex.
      const rtiCalls = calls.filter(c => c.url.includes('api.retsinformation.dk')).length;
      assert.equal(rtiCalls - before, days.length + 2);
    } finally {
      rtiFail = null;
    }
  });

  test('finlex: 5 records (löpande år 3 + föregående 2), avdubblad på lagenr', () => {
    const recs = colRecs.finlex;
    const y = new Date().getFullYear();
    assert.equal(recs.length, 5);
    const byInd = i => recs.find(r => r.indicator === i);
    assert.equal(byInd(`Lagversioner ${y}`)?.value, finCur.length); // 38 (24+14 språkversioner)
    assert.equal(byInd(`Nya lagar ${y}`)?.value, 12);
    assert.equal(byInd(`Ändrade lagar ${y}`)?.value, 7);
    assert.equal(byInd(`Nya lagar ${y - 1} (hela året)`)?.value, 6);
    assert.equal(byInd(`Ändrade lagar ${y - 1} (hela året)`)?.value, 4);
    // Paginering: 38 poster → 4 sidor, 17 → 2 sidor (limit 10).
    assert.equal(calls.filter(c => c.url.includes('opendata.finlex.fi')).length, 6);
  });

  test('finlex: 429 på en sida → progressiv backoff, retry lyckas → fullt totalt', async () => {
    finlex429 = { page: 3, times: 2 }; // två 429:or på sida 3, sedan 200
    try {
      const y = new Date().getFullYear();
      const stat = await countYear(y);
      assert.equal(stat.entries, finCur.length);
      assert.equal(stat.pages, 4); // 38 poster → 4 sidor
      assert.equal(stat.new.size, 12);
      assert.equal(stat.modified.size, 7);
      assert.equal(stat.capped, false);
      assert.equal(stat.failed, false);
    } finally {
      finlex429 = null;
    }
  });

  test('finlex: ihållande 429 → delvis totalt bevaras (estimat, ej failed)', async () => {
    finlex429 = { page: 3, times: Infinity };
    try {
      const y = new Date().getFullYear();
      const stat = await countYear(y);
      assert.equal(stat.entries, 20); // sidorna 1–2 räknades före rate-limtet
      assert.equal(stat.pages, 2);
      assert.equal(stat.capped, true);
      assert.equal(stat.failed, false);
      assert.ok(stat.new.size + stat.modified.size > 0);
    } finally {
      finlex429 = null;
    }
  });

  test('finlex: 429 från första sidan (ingen data) → failed', async () => {
    finlex429 = { page: 1, times: Infinity };
    try {
      const y = new Date().getFullYear();
      const stat = await countYear(y);
      assert.equal(stat.entries, 0);
      assert.equal(stat.failed, true);
      assert.equal(stat.capped, true);
    } finally {
      finlex429 = null;
    }
  });

  test('ipu: 34 records (SE/NO/DK/FI à 7, IS 6 – saknar partier)', () => {
    const recs = colRecs.ipu;
    assert.equal(recs.length, 34);
    const per = cc => recs.filter(r => r.country === cc);
    for (const cc of ['SE', 'NO', 'DK', 'FI']) assert.equal(per(cc).length, 7, cc);
    assert.equal(per('IS').length, 6);
    assert.ok(!recs.some(r => r.country === 'IS' && /Politiska partier/.test(r.indicator ?? '')));
    assert.equal(recs.find(r => r.country === 'SE' && r.indicator === 'Politiska partier (IPU)')?.value, 10);
    assert.equal(recs.find(r => r.country === 'NO' && r.indicator === 'Politiska partier (IPU)')?.value, 0);
    assert.equal(recs.find(r => r.country === 'SE' && r.indicator === 'Lagar antagna per år (IPU)')?.value, 608);
    const seDays = recs.find(r => r.country === 'SE' && /^Dagar sedan senaste val/.test(r.indicator ?? ''));
    assert.match(seDays.indicator, /\(2022-09-18\)$/);
    assert.ok(Math.abs(seDays.value - daysSince('2022-09-18')) <= 1);
    // 4 anrop per land (parlament, kammare, val, partier) × 5 = 20.
    assert.equal(calls.filter(c => c.url.includes('api.data.ipu.org')).length, 20);
  });

  test('dataportal: 20 records (2 metrics + 2 events) × 5 länder', () => {
    const recs = colRecs.dataportal;
    assert.equal(recs.length, 20);
    for (const [cc, hub] of Object.entries(HUB_COUNTRIES)) {
      const per = recs.filter(r => r.country === cc);
      assert.equal(per.length, 4, cc);
      assert.equal(per.find(r => r.indicator === 'Öppna dataset i data.europa.eu')?.value, dpFx[hub].total);
      assert.equal(per.find(r => r.indicator === 'Dataset uppdaterade (≤30 d)')?.value, dpFx[hub].recent);
      const evts = per.filter(r => r.t === 'e');
      assert.equal(evts.length, 2, cc);
      assert.equal(evts[0].title, titleOf(dpFx[hub].samples[0]), cc);
      assert.equal(evts[1].title, titleOf(dpFx[hub].samples[1]), cc);
      assert.equal(evts[0].detail, dpFx[hub].samples[0].catalog.name, cc);
    }
  });

  test('cellar: 4 records (år YTD + L/R/D), cc NORDIC', () => {
    const recs = colRecs.cellar;
    const y = new Date().getFullYear();
    assert.equal(recs.length, 4);
    assert.ok(recs.every(r => r.country === 'NORDIC' && r.source === 'cellar'));
    assert.equal(recs.find(r => r.indicator === `EU-rättsliga texter ${y} (CELEX, YTD)`)?.value, 2736);
    assert.equal(recs.find(r => r.indicator === `EU-direktiv ${y}`)?.value, 412);
    assert.equal(recs.find(r => r.indicator === `EU-förordningar ${y}`)?.value, 1288);
    assert.equal(recs.find(r => r.indicator === `EU-beslut ${y}`)?.value, 847);
  });
});

// ---- Förvaltningsindex ------------------------------------------------------------
describe('Förvaltningsindex (analys)', () => {
  const st = c => forvaltningStatus(c, allRecs);

  test('fixtures: senaste valet inom 7 år (IPU-kontinuitetströskel)', () => {
    for (const [cc, iso] of Object.entries(ELECTION_MAX)) {
      assert.ok(daysSince(iso) <= 7 * 365, `${cc}: ${iso} inom 7 år`);
    }
  });

  test('ankrar: per-land index ur fixtures (regressionsvärden)', () => {
    const no = st('NO');
    assert.deepEqual(
      [no.components.aktivitet.score, no.components.kontinuitet.score, no.components.observerbarhet.score, no.score, no.label],
      [53.5, 100, 72.0, 73.0, 'Stabilt']);
    const dk = st('DK');
    assert.deepEqual(
      [dk.components.aktivitet.score, dk.components.kontinuitet.score, dk.components.observerbarhet.score, dk.score, dk.label],
      [32.8, 100, 63.3, 62.1, 'Stabilt']);
    const fi = st('FI');
    assert.deepEqual(
      [fi.components.aktivitet.score, fi.components.kontinuitet.score, fi.components.observerbarhet.score, fi.score, fi.label],
      [34.3, 100, 46.9, 57.8, 'Stabilt']);
    const is = st('IS');
    assert.deepEqual(
      [is.components.aktivitet.score, is.components.kontinuitet.score, is.components.observerbarhet.score, is.score, is.label],
      [32.2, 100, 44.6, 56.3, 'Stabilt']);
    // SE beror på fixturekalendern: ≥1 framtida händelse → riksdagens
    // kontinuitet 1 (SE 82.0 Hög trygghet); alla passerade → 0.2 (SE 76.0).
    const se = st('SE');
    assert.deepEqual(
      [se.components.aktivitet.score, se.components.kontinuitet.score, se.components.observerbarhet.score, se.score],
      [78.4, seKont, 68.8, seScore]);
    assert.equal(se.label, 'Hög trygghet');
    // Källuppsättningen: nationell + gemensamma källor.
    assert.deepEqual(se.sources, ['cellar', 'dataportal', 'ipu', 'riksdagen']);
    assert.deepEqual(is.sources, ['cellar', 'dataportal', 'ipu']); // IS saknar nationell källa
  });

  test('ankrar: NORDIC = snitt av de fem länderna, per-land-rader i drivers', () => {
    const n = st('NORDIC');
    assert.equal(n.country, 'NORDIC');
    assert.deepEqual(n.countries.map(x => x.country), NORDIC);
    const expected = round1((seScore + 73.0 + 62.1 + 57.8 + 56.3) / 5);
    assert.equal(n.score, expected);
    assert.equal(n.label, 'Stabilt');
    assert.equal(n.drivers.length, 5);
    n.countries.forEach((x, i) => {
      assert.ok(n.drivers[i].startsWith(`${NORDIC[i]}: `), n.drivers[i]);
      assert.ok(n.drivers[i].includes(`(${x.label})`), n.drivers[i]);
    });
    assert.equal(n.countries.find(x => x.country === 'SE').score, seScore);
    // Komponenterna = snitt av landernas komponentpoäng.
    assert.equal(n.components.aktivitet.score, round1((78.4 + 53.5 + 32.8 + 34.3 + 32.2) / 5));
    assert.equal(n.components.kontinuitet.score, seKont === 100 ? 100 : round1((seKont + 4 * 100) / 5));
    assert.equal(n.components.observerbarhet.score, round1((68.8 + 72.0 + 63.3 + 46.9 + 44.6) / 5));
    assert.deepEqual(n.sources, ['cellar', 'dataportal', 'fdk', 'finlex', 'ipu', 'retsinformation', 'riksdagen']);
    assert.ok(n.asOf);
  });

  test('drivrader: per-källa signaler (spotkontroller)', () => {
    const y = new Date().getFullYear();
    const se = st('SE');
    assert.ok(se.drivers[0].includes('riksdagen: 6 kalenderhändelser, 3 omröstningar, 5 anföranden'));
    assert.ok(se.drivers[0].includes('cellar: 2736 EU-rättsliga texter (YTD)'));
    assert.ok(se.drivers[1].includes(`riksdagen: ${futureCount} kommande kalenderhändelser`));
    const no = st('NO');
    assert.ok(no.drivers[0].includes('fdk: 799 nyregistrerade dataset ≤365 d av 9227 totalt'));
    assert.ok(no.drivers[2].includes('fdk: 99% öppna av 9227 dataset'));
    const dk = st('DK');
    assert.ok(dk.drivers[0].includes('retsinformation: 20 lagändringar senaste 7 d'));
    assert.ok(dk.drivers[2].includes('retsinformation: 5 dokumenttyper publicerade'));
    const fi = st('FI');
    assert.ok(fi.drivers[0].includes(`finlex: 12 nya lagar ${y} (löpande)`));
    assert.ok(fi.drivers[2].includes(`finlex: 48 lagversioner publicerade (inkl. 10 från ${y - 1})`));
    const is = st('IS');
    assert.ok(is.drivers[0].includes('ipu: 40 lagar/år'));
  });

  test('renormering: saknad källa → vikterna fördelas över de övriga', () => {
    const n = now();
    const fut = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const syn = [
      { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Kalenderhändelser, kammarkalendern', value: 6, unit: 'st', ts: n },
      { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Omröstningar (kammaråret x)', value: 3, unit: 'st', ts: n },
      { t: 'm', area: 12, country: 'SE', source: 'riksdagen', indicator: 'Anföranden (kammaråret x)', value: 5, unit: 'st', ts: n },
      { t: 'e', area: 12, country: 'SE', source: 'riksdagen', kind: 'kammarkalender', severity: 'info', title: 'Kommande', detail: '', start: `${fut}T12:00:00` },
    ];
    const s = forvaltningStatus('SE', syn);
    // Bara riksdagen: aktivitet log10(1+6+0.75+0.75)/2 → 46.5, kontinuitet 100
    // (framtida händelse), observerbarhet saknas (inga ledamötsdata) →
    // poäng = (0.4·46.5 + 0.3·100)/0.7.
    assert.equal(s.components.observerbarhet, null);
    assert.equal(s.components.aktivitet.score, 46.5);
    assert.equal(s.components.kontinuitet.score, 100);
    assert.equal(s.score, 69.4);
    assert.equal(s.label, 'Stabilt');
    assert.ok(s.drivers.some(d => d.startsWith('Observerbarhet: saknar öppningsdata')));
  });

  test('freshness: gammal data sänker kontinuitet, års-enkelts anses frisk', () => {
    const oldTs = new Date(Date.now() - 2 * 86400000).toISOString();
    const syn = [
      { t: 'm', area: 12, country: 'DK', source: 'retsinformation', indicator: 'Lagändringar, senaste 7 dygn', value: 20, unit: 'st', ts: oldTs },
      { t: 'm', area: 12, country: 'DK', source: 'retsinformation', indicator: 'Lagändringar per typ: BEK (7 d)', value: 9, unit: 'st', ts: oldTs },
    ];
    const s = forvaltningStatus('DK', syn);
    // Daglig takt: 2 dagar = 2× takt → kontinuitet 1 · (1 − 1/2) = 0.5 → 50.
    assert.equal(s.components.kontinuitet.score, 50);
    assert.equal(s.components.aktivitet.score, 4);
    assert.equal(s.components.observerbarhet.score, 12.5);
    assert.equal(s.score, 20.4);
    assert.equal(s.label, 'Svag');

    // Års-enkelts (finlex-mönstret, t.ex. "2026") → anses friskt.
    const y = new Date().getFullYear();
    const fin = [
      { t: 'm', area: 12, country: 'FI', source: 'finlex', indicator: `Lagversioner ${y}`, value: 38, unit: 'st', ts: String(y) },
      { t: 'm', area: 12, country: 'FI', source: 'finlex', indicator: `Nya lagar ${y}`, value: 12, unit: 'st', ts: String(y) },
    ];
    const f = forvaltningStatus('FI', fin);
    assert.equal(f.components.kontinuitet.score, 100);
    assert.equal(f.components.aktivitet.score, 4);
    assert.equal(f.components.observerbarhet.score, 1.3); // 38/3000
  });

  test('tomma data → okänt (score null)', () => {
    for (const c of ['SE', 'NORDIC']) {
      const s = forvaltningStatus(c, []);
      assert.equal(s.score, null);
      assert.equal(s.label, 'Okänt');
      assert.ok(Object.values(s.components).every(x => x === null));
    }
    // Landsvy utan data för just landet (endast NO-källan) → okänt.
    const s = forvaltningStatus('SE', allRecs.filter(r => r.source === 'fdk'));
    assert.equal(s.score, null);
    assert.equal(s.label, 'Okänt');
  });

  test('vikter: konfig + vägt summa = 1', () => {
    assert.deepEqual(WEIGHTS, { aktivitet: 0.4, kontinuitet: 0.3, observerbarhet: 0.3 });
    assert.ok(Math.abs(Object.values(WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  });
});

// ---- forvaltningData (panelens data) ----------------------------------------------
describe('forvaltningData (paneldata)', () => {
  test('ALL: samtliga records, sorterade desc, källsammanfattning med counts', () => {
    const d = forvaltningData('ALL', sources);
    assert.equal(d.records.length, allRecs.length);
    for (let i = 1; i < d.records.length; i += 1) {
      const a = String(d.records[i - 1].ts ?? d.records[i - 1].start ?? '');
      const b = String(d.records[i].ts ?? d.records[i].start ?? '');
      assert.ok(a >= b, `sortering vid ${i}`);
    }
    assert.equal(d.sources.length, 7);
    for (const s of d.sources) {
      assert.equal(s.count, colRecs[s.id].length, s.id);
      assert.ok(s.name && s.country && s.every > 0 && s.status === 'ok');
    }
    assert.deepEqual(d.sources.map(s => s.id).sort(), Object.keys(COLS).sort());
  });

  test('landsfilter: egna + NORDIC (gemensamma) records', () => {
    const dSe = forvaltningData('SE', sources);
    assert.equal(dSe.records.length, colRecs.riksdagen.length + 7 + 4 + 4); // riksdagen + ipu SE + dataportal SE + cellar
    assert.ok(dSe.records.every(r => r.country === 'SE' || r.country === 'NORDIC'));
    const dIs = forvaltningData('IS', sources);
    assert.equal(dIs.records.length, 6 + 4 + 4); // ipu IS (utan partier) + dataportal IS + cellar
    assert.ok(dIs.records.every(r => r.country === 'IS' || r.country === 'NORDIC'));
    assert.ok(!dIs.records.some(r => r.source === 'riksdagen'));
    assert.ok(!dSe.records.some(r => r.source === 'fdk'));
  });
});
