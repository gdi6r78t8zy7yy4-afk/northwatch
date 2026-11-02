// Copernicus Climate Data Store (CDS) – ERA5-reanalys över Norden (område 11).
// NYCKELKRÄVande: CDS_TOKEN (gratis personal access token,
// https://cds.climate.copernicus.eu/profile) + CDS_EMAIL (kontots e-post –
// CDS kräver båda per anrop). Verifierat 2026-11-02:
//   multipart POST https://cds.climate.copernicus.eu/api/v2
//   (Node 20+ global FormData + fetch fungerar för multipart; kollektorn
//   har aldrig kört utan token i testnätet).
// Frågan: 2m_temperature, ERA5 single levels, nordisk bbox (samma
// NORDIC_BBOX som övriga källor), igår 00:00 UTC (ERA5 har driftsfördröjning),
// CSV ≈ 15 000 punkter. Svars-CSV: långa kommentarrader (#), sedan
// rubriken variable,longitude,latitude,time,value och en rad per punkt.
import { UA } from '../lib/http.js';

// nord, väst, syd, öst – NORDIC_BBOX i geolayers.js
const BBOX = [71.4, -24.9, 54.3, 31.9];

export default {
  id: 'cds',
  name: 'CDS/ERA5 (nordisk temperatur)',
  area: 11,
  country: 'NORDIC',
  every: 21600,
  need: 'CDS_TOKEN',
  fetch: async () => {
    if (!process.env.CDS_EMAIL) {
      throw new Error('Saknar CDS_EMAIL (CDS kräver kontots e-post per anrop)');
    }
    const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const request = {
      product_type: 'reanalysis',
      dataset: 'era5',
      variable: ['2m_temperature'],
      area: BBOX,
      date: [day, day],
      time: ['00:00'],
      format: 'csv',
    };
    const form = new FormData();
    form.append('request', JSON.stringify(request));
    const r = await fetch('https://cds.climate.copernicus.eu/api/v2', {
      method: 'POST',
      headers: {
        token: process.env.CDS_TOKEN,
        email: process.env.CDS_EMAIL,
        'User-Agent': UA(),
      },
      body: form,
      signal: AbortSignal.timeout(10 * 60 * 1000), // CDS-jobb kan ta tid
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`CDS HTTP ${r.status}: ${body.slice(0, 200)}`);
    }
    const text = await r.text();
    // Hoppa över kommentarrader (#) och hitta CSV-rubriken.
    const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
    const hdrIdx = lines.findIndex(l => /^variable,/.test(l));
    if (hdrIdx === -1) throw new Error('CDS: ingen CSV-rubrik i svaret');
    const cols = lines[hdrIdx].split(',').map(s => s.trim());
    const iV = cols.indexOf('value');
    const vals = [];
    for (const l of lines.slice(hdrIdx + 1)) {
      const v = Number(l.split(',')[iV]);
      if (Number.isFinite(v)) vals.push(v);
    }
    if (!vals.length) throw new Error('CDS: CSV-svaret innehöll inga värden');
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const ts = `${day}T00:00:00Z`;
    const m = (indicator, value) => ({
      t: 'm', area: 11, country: 'NORDIC', source: 'cds',
      indicator, value: Math.round(value * 10) / 10, unit: '°C', ts,
    });
    return [
      m(`ERA5 2m-temperatur Norden – medelvärde (${vals.length} punkter)`, mean),
      m('ERA5 2m-temperatur Norden – min', Math.min(...vals)),
      m('ERA5 2m-temperatur Norden – max', Math.max(...vals)),
    ];
  },
};
