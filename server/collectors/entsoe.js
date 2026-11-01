// ENTSO-E Transparency Platform REST API (nya, web-api.tp.entsoe.eu) –
// dag-ahead-priser (A44), vind/sol-produktion (A74), produktion per typ (A75),
// gränsflöden (A11). IEC 62325 XML → fast-xml-parser (enbart JS-beroende).
//
// Verifierad 2026-11-01 mot publik OpenAPI-spec:
//   A44  ENERGY_PRICES [12.1.D]                     – In_Domain==Out_Domain (BZ)
//   A74/75 AGGREGATED_GENERATION_PER_TYPE_R3 [16.1.B&C] – In_Domain
//   A11  NET_CROSS_BORDER_PHYSICAL_FLOWS_R3 [12.1.G]   – In_Domain/Out_Domain
//   A65  är ej tillgängligt via denna tjänst ("not allowed").
//   Periodformat yyyyMMddHHmm (UTC); GET-parametrar är skiftlägeskänsliga
//   (fösta bokstaven gemener).
// OBS: vid verifieringen svarade datalagret "No matching data" för alla
// nordiska zoner och alla testade intervall (2025-06 → 2026-12). Kollektorn
// rapporterar då ett status-händelseistället och börjar automatiskt leverera
// metrik när data finns i lagret.
//
// Token i .env (ENTSO_E_TOKEN).
import { XMLParser } from 'fast-xml-parser';
import { j, now } from '../lib/http.js';

const BASE = process.env.ENTSO_E_BASE || 'https://web-api.tp.entsoe.eu/api';
const ZONES = { SE: '10XSE-1!!!!!!', NO: '10XNO-1!!!!!!', FI: '10XFI-1!!!!!!' };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

const pad = n => String(n).padStart(2, '0');
const ymdhmm = d =>
  `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
  `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;

const arr = x => (Array.isArray(x) ? x : x ? [x] : []);

// En fråga → {data:true, doc} (IEC-marknadsdokument) eller
// {data:false, note} (Acknowledgement: "No matching data" m.m.).
async function query(params) {
  const url = `${BASE}?${new URLSearchParams({ ...params, securityToken: process.env.ENTSO_E_TOKEN })}`;
  const r = await j(url, { headers: { Accept: 'application/xml' }, timeout: 45000 });
  const doc = parser.parse(await r.text());
  if (doc.Acknowledgement_MarketDocument) {
    const reason = doc.Acknowledgement_MarketDocument.Reason ?? {};
    return { data: false, note: reason.text ?? `OK-känning (${reason.code ?? '?'})` };
  }
  return { data: true, doc };
}

// Extrahera punkter ur ett IEC 62325-dokuments TimeSeries (quantitet eller pris).
function points(doc) {
  const key = Object.keys(doc).find(k => k.endsWith('_MarketDocument'));
  const d = doc[key] ?? {};
  const out = [];
  for (const ts of arr(d.TimeSeries)) {
    const zone =
      ts.outBiddingZone_Domain?.mRID ?? ts.in_Domain?.mRID ??
      ts.biddingZone_Domain?.mRID ?? ts.out_Domain?.mRID ?? '?';
    const start = ts.Period?.timeInterval?.start ?? d.period?.timeInterval?.start ?? null;
    for (const p of arr(ts.Period?.Point)) {
      const value =
        p.quantity != null ? Number(p.quantity)
        : p.price != null ? Number(p.price.amount ?? p.price)
        : null;
      if (value == null || !Number.isFinite(value)) continue;
      out.push({
        zone,
        value,
        currency: (p.price && (p.price.currency ?? p.price['@_currency'])) || undefined,
        at: start,
      });
    }
  }
  return out;
}

const zoneOf = eic => Object.entries(ZONES).find(([, m]) => m === eic)?.[0] ?? eic;

export default {
  id: 'entsoe',
  name: 'ENTSO-E Transparency',
  area: 1,
  country: 'NORDIC',
  every: 600,
  need: 'ENTSO_E_TOKEN',
  fetch: async () => {
    const end = new Date();
    end.setUTCMinutes(0, 0, 0); // senaste hela timmen (UTC)
    const start = new Date(end.getTime() - 3600e3);
    const period = { periodStart: ymdhmm(start), periodEnd: ymdhmm(end) };
    const records = [];
    const notes = [];

    // 1) Dag-ahead-pris per zon (A44, In==Out=BZ).
    for (const [cc, eic] of Object.entries(ZONES)) {
      const q = await query({ documentType: 'A44', In_Domain: eic, Out_Domain: eic, ...period });
      if (!q.data) { notes.push(`A44 ${cc}: ${q.note}`); continue; }
      const pts = points(q.doc).filter(p => p.zone === eic);
      const last = pts[pts.length - 1];
      if (last) records.push({
        t: 'm', area: 1, country: cc, source: 'entsoe',
        indicator: `Dag-ahead-pris ${cc}`,
        value: last.value, unit: `${last.currency ?? 'EUR'}/MWh`, ts: last.at ?? now(),
      });
    }

    // 2) Vind + sol-produktion per zon (A74, realiserad).
    for (const [cc, eic] of Object.entries(ZONES)) {
      const q = await query({ documentType: 'A74', In_Domain: eic, processType: 'A16', ...period });
      if (!q.data) { notes.push(`A74 ${cc}: ${q.note}`); continue; }
      const pts = points(q.doc).filter(p => p.zone === eic);
      const last = pts[pts.length - 1];
      if (last) records.push({
        t: 'm', area: 1, country: cc, source: 'entsoe',
        indicator: `Vind+sol-produktion ${cc}`,
        value: last.value, unit: 'MW', ts: last.at ?? now(),
      });
    }

    // 3) Gränsflöden (A11) – fyller Statnetts SE–FI-lucka när lagret fylls.
    for (const [inCc, outCc] of [['SE', 'FI'], ['SE', 'NO'], ['NO', 'SE']]) {
      const q = await query({
        documentType: 'A11',
        In_Domain: ZONES[inCc], Out_Domain: ZONES[outCc],
        processType: 'A16', ...period,
      });
      if (!q.data) { notes.push(`A11 ${inCc}-${outCc}: ${q.note}`); continue; }
      const pts = points(q.doc);
      const last = pts[pts.length - 1];
      if (last) records.push({
        t: 'm', area: 1, country: 'NORDIC', source: 'entsoe',
        indicator: `Nettoflöde ${inCc}→${outCc}`,
        value: last.value, unit: 'MW', ts: last.at ?? now(),
      });
    }

    if (!records.length) {
      // Struktur verifierad, men datalagret har inga svar ännu – ärlig status.
      records.push({
        t: 'e', area: 1, country: 'NORDIC', source: 'entsoe',
        kind: 'källstatus', severity: 'info',
        title: 'ENTSO-E: inga data i API-svaren (struktur verifierad)',
        detail: notes.slice(0, 3).join(' · ') || 'A44/A74/A11 gav inga data för senaste timmen',
        start: now(),
      });
    }
    return records;
  },
};
