// Interaktiv karta (M3): Leaflet + OSM-kartunderlag.
// Lager:
//   – landsgränser (statisk GeoJSON via backend, Natural Earth)
//   – energilagret: HVDC-länkar + schematiska zonskilda (område 1)
//   – zonflöden i realtid (Statnett + Svenska kraftnät, live-mittade MW)
//   – anläggningspunkter: IX (PeeringDB), OSM (kraft/datacenter/flyg/vatten),
//     Trafikverket flödesmätare (topp 25) + följda järnvägsstationer (M5)
//     + speedkameror på huvudvägar (E + riksvägar, M7; ~900 punkter)
//   – händelser med geografi (t.ex. Digitraffic vägtrafik, FI, Trafikverket)
// M6: kartvalet styrs av en egen vy-effekt som bara löper vid kontextbyte
//     (område/land), när landsgränserna laddats klart och via "Återställ vy" –
//     30 s-uppdateringen ritar om datalagren men flyttar ALDRIG kartan.
//     Störlek S/M/L väljs av användaren och minns i webbläsaren (nw-mapsize).
// M8: prognosrutnät (SMHI snow1g, område 11) som imageOverlay under alla
//     datalager – nu-steg i aktuell cykel, parameterväljare i verktygsraden.
//     onMapClick(latlng) → väderpanelen hämtar punktprognos för klickplatsen.
// Allt servas av backend – frontend pratar aldrig med externa källor.
import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchForecastGrid, fetchForecastGridCoords } from '../api.js';
import { fmtTime } from '../status.js';
import { nowIndex, paintWxGrid, WX_RAMPS } from '../lib/wxGrid.js';

const NORDIC_CENTER = [64.5, 8];
const NORDIC_ZOOM = 4;

// M6: kartstorlek (px). M = tidigare CSS-standard (420 px).
export const MAP_SIZES = { S: 260, M: 420, L: 580 };
const MAP_SIZE_KEY = 'nw-mapsize';

const readMapSize = () => {
  try {
    const v = localStorage.getItem(MAP_SIZE_KEY);
    return Object.prototype.hasOwnProperty.call(MAP_SIZES, v) ? v : 'M';
  } catch {
    return 'M';
  }
};

const TYPE_COLORS = {
  ix: '#7c5cd6',
  kraftanläggning: '#e0662e',
  datacenter: '#9b3fd4',
  flygplats: '#2e86c1',
  vattenverk: '#14b8a6',
  fartyg: '#0f8b8d',
  flowmatning: '#e0a52e',
  station: '#c2418f',
  kamera: '#2f9e44',
};

const TYPE_LABELS = {
  ix: 'Internetutbyte (IX)',
  kraftanläggning: 'Kraftanläggning / elnät (OSM)',
  datacenter: 'Datacenter (OSM)',
  flygplats: 'Flygplats (OSM)',
  vattenverk: 'Vattenverk (OSM)',
  fartyg: 'Fartyg i rörelse (AIS, Digitraffic Meri)',
  flow: 'Zonflöde (Statnett/SVK)',
  flowmatning: 'Flödesmätare (Trafikverket)',
  station: 'Järnvägsstation (Trafikverket)',
  kamera: 'Speedkamera (Trafikverket)',
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function popupHtml(a) {
  const rows = Object.entries(a.attrs ?? {})
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `<div class="poprow"><span>${esc(k)}</span><b>${esc(v)}</b></div>`)
    .join('');
  return `<div class="pop"><b>${esc(a.name)}</b>`
    + `<div class="mut">${TYPE_LABELS[a.type] ?? a.type} · källa: ${esc(a.source)}</div>${rows}</div>`;
}

export default function MapPanel({
  area, country, assets = [], staticGeo = null, events = [],
  forecastMeta = null, onMapClick = null,
}) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const clickRef = useRef(null);
  const [size, setSize] = useState(readMapSize);
  const [resetNonce, setResetNonce] = useState(0);
  const [wxParam, setWxParam] = useState(null);
  const [wx, setWx] = useState(null);
  const [wxErr, setWxErr] = useState(null);

  // M8: väderprognosrutnätet aktiveras när föräldern skickar meta (område 11).
  const wxOn = !!forecastMeta?.ready;

  const chooseSize = s => {
    setSize(s);
    try { localStorage.setItem(MAP_SIZE_KEY, s); } catch { /* privat läge m.m. */ }
  };

  // Bygg kartan en gång, riva vid unmount.
  useEffect(() => {
    if (!divRef.current || mapRef.current) return undefined;
    const map = L.map(divRef.current, { worldCopyJump: false });
    map.setView(NORDIC_CENTER, NORDIC_ZOOM);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 14,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-medarbetare',
    }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // M6: storleksändring – Leaflet behöver veta den nya behållarhöjden.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const t = setTimeout(() => map.invalidateSize(), 0);
    return () => clearTimeout(t);
  }, [size]);

  // M8: klick var som helst på kartan → onMapClick({lat, lon}). Händlern
  // bindes en gång; senaste callbacken läses via ref (undviker att Leaflet
  // lagar en stängd capture av en gammal onMapClick).
  useEffect(() => { clickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const h = e => clickRef.current?.({ lat: e.latlng?.lat, lon: e.latlng?.lng });
    map.on('click', h);
    return () => map.off('click', h);
  }, []);

  // M8: prognosrutnät – nu-steg i aktuell cykel, parameterns värden +
  // statiska rutnätskoordinater. Uppdateras vid cykelbyte, parametrabyte
  // och var 30:e sekund.
  useEffect(() => {
    if (!wxOn) {
      setWx(null);
      setWxErr(null);
      return;
    }
    if (!wxParam) setWxParam(forecastMeta.grid.parameters[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wxOn, wxParam, forecastMeta?.createdTime]);

  useEffect(() => {
    if (!wxOn || !wxParam) return undefined;
    let stop = false;
    const load = async () => {
      const time = forecastMeta.times[nowIndex(forecastMeta.times)];
      const [g, c] = await Promise.all([
        fetchForecastGrid(wxParam, time, forecastMeta.grid.downsample),
        fetchForecastGridCoords(forecastMeta.grid.downsample),
      ]);
      if (stop) return;
      if (g.ok && c.ok) {
        setWx({
          parameter: g.body.parameter,
          values: g.body.values,
          coords: c.body.coordinates,
          time,
          createdTime: g.body.createdTime,
        });
        setWxErr(null);
      } else {
        setWx(null);
        setWxErr(g.body?.error ?? c.body?.error ?? 'Kunde inte hämta prognosrutnätet');
      }
    };
    load().catch(() => {
      if (!stop) { setWx(null); setWxErr('Kunde inte hämta prognosrutnätet'); }
    });
    const t = setInterval(load, 30000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wxOn, wxParam, forecastMeta?.createdTime]);

  // Datalagren uppdateras vid förändring – rör aldrig kartvalet (M6).
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const sel = country === 'ALL' ? null : country;

    // M8: prognosrutnät först – imageOverlay ligger under alla datalager.
    if (wx) {
      const grid = paintWxGrid(wx.values, wx.coords, wx.parameter);
      if (grid) {
        L.imageOverlay(grid.url, grid.bbox, {
          opacity: 0.55,
          className: 'wxgrid',
          interactive: false,
        }).addTo(layer);
      }
    }

    // Landsgränser – markerat land framhäft.
    if (staticGeo?.countries?.features?.length) {
      L.geoJSON(staticGeo.countries, {
        style: f => {
          const isSel = sel === f.properties.code;
          return {
            color: '#4a7fd4',
            weight: isSel ? 2.5 : 1.2,
            opacity: sel && !isSel ? 0.35 : 0.9,
            fillColor: '#8fb7ea',
            fillOpacity: isSel ? 0.10 : 0.04,
          };
        },
        onEachFeature: (f, l) => l.bindTooltip(f.properties.name, { sticky: true }),
      }).addTo(layer);
    }

    // Energi: HVDC-länkar (statiska) + zonskilda.
    if (area.id === 1 && staticGeo?.energy?.features) {
      for (const f of staticGeo.energy.features) {
        const p = f.properties;
        if (p.kind === 'zone') {
          const [lng, lat] = f.geometry.coordinates;
          L.circleMarker([lat, lng], {
            radius: 4, color: '#5b6470', weight: 1, fillColor: '#fff', fillOpacity: 0.95,
          }).bindTooltip(p.zone, { permanent: true, direction: 'top', className: 'zone-label' })
            .addTo(layer);
        } else if (p.kind === 'link') {
          const coords = f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
          const planned = p.status === 'planerad';
          L.polyline(coords, {
            color: planned ? '#9aa5b1' : '#e08a2e',
            weight: 1 + Math.min(2, (p.mw ?? 0) / 700),
            dashArray: planned ? '6 6' : null,
            opacity: 0.8,
          }).bindTooltip(`${p.name} · ${p.mw} MW · ${p.status}${p.note ? ` · ${p.note}` : ''}`)
            .addTo(layer);
        }
      }
    }

    // Asset: punkter (IX, OSM) och linjer (Statnett/SVK-flöden).
    for (const a of assets) {
      const g = a.geometry;
      if (g?.type === 'Point') {
        const [lng, lat] = g.coordinates;
        L.circleMarker([lat, lng], {
          radius: a.type === 'ix' ? 4.5 : a.type === 'kamera' ? 2.5 : 3.5,
          color: '#fff', weight: 1,
          fillColor: TYPE_COLORS[a.type] ?? '#888',
          fillOpacity: 0.9,
        }).bindPopup(popupHtml(a), { maxWidth: 280 }).addTo(layer);
      } else if (g?.type === 'LineString') {
        const coords = a.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const mw = a.attrs?.mw;
        const color = a.type === 'flow' ? (mw >= 0 ? '#2e9e5b' : '#d4574a') : '#e08a2e';
        L.polyline(coords, {
          color,
          weight: a.type === 'flow' ? 1 + Math.min(2.5, Math.abs(mw ?? 0) / 700) : 2,
          opacity: 0.65,
        }).bindTooltip(a.type === 'flow' ? `${a.name} · ${Math.round(mw)} MW` : a.name)
          .addTo(layer);
      }
    }

    // Händelser med geografi (t.ex. Digitraffic MultiLineString).
    for (const ev of events) {
      if (!ev.geo) continue;
      const feat = { type: 'Feature', properties: { title: ev.title }, geometry: ev.geo };
      L.geoJSON(feat, {
        style: { color: '#d4574a', weight: 2.5, opacity: 0.75 },
        onEachFeature: (f, l) => l.bindTooltip(f.properties.title),
      }).addTo(layer);
    }
  }, [area.id, country, assets, staticGeo, events, wx]);

  // Kartvalet (M6): bara vid kontextbyte (område/land), när landsgränserna
  // har laddats, eller vid manuell "Återställ vy". 30 s-uppdateringen byter
  // aldrig referens på någon av dessa avbildningar – kartan står stilla.
  const geoReady = !!staticGeo?.countries?.features?.length;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (country === 'ALL') {
      map.setView(NORDIC_CENTER, NORDIC_ZOOM);
      return;
    }
    if (!geoReady) return; // väntar på landsgränserna – ingen fallback-vy
    const feat = staticGeo.countries.features.find(f => f.properties.code === country);
    if (feat) {
      const b = L.geoJSON(feat).getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.08), { maxZoom: 7 });
    } else {
      map.setView(NORDIC_CENTER, NORDIC_ZOOM);
    }
  }, [area.id, country, geoReady, resetNonce]);

  const hasEnergy = area.id === 1;
  const hasIx = assets.some(a => a.type === 'ix');
  const hasOsm = assets.some(a => a.source === 'osm');
  const hasFlow = assets.some(a => a.type === 'flow');
  const hasFartyg = assets.some(a => a.type === 'fartyg');
  const hasFlowmatning = assets.some(a => a.type === 'flowmatning');
  const hasStation = assets.some(a => a.type === 'station');
  const hasKamera = assets.some(a => a.type === 'kamera');
  const hasEvents = events.length > 0;
  const empty = !hasIx && !hasOsm && !hasFlow && !hasFartyg && !hasFlowmatning
    && !hasStation && !hasKamera && !hasEvents;

  return (
    <div className="card">
      <h2>
        Karta
        <span className="maptools">
          {wxOn && (
            <select
              className="wxsel"
              value={wxParam ?? ''}
              onChange={e => setWxParam(e.target.value)}
              aria-label="Prognosparameter"
            >
              {forecastMeta.grid.parameters.map(p => (
                <option key={p} value={p}>{WX_RAMPS[p]?.label ?? p}</option>
              ))}
            </select>
          )}
          <span className="seg" role="group" aria-label="Kartstorlek">
            {Object.keys(MAP_SIZES).map(s => (
              <button key={s} type="button" className={s === size ? 'on' : ''}
                aria-pressed={s === size}
                title={`Storlek ${s} (${MAP_SIZES[s]} px)`}
                onClick={() => chooseSize(s)}>
                {s}
              </button>
            ))}
          </span>
          <button type="button" className="tbtn" onClick={() => setResetNonce(n => n + 1)}>
            Återställ vy
          </button>
        </span>
      </h2>
      <div ref={divRef} className="mapbox" style={{ height: MAP_SIZES[size] }} />
      <div className="maplegend mut">
        <span><i style={{ background: '#4a7fd4' }} />Landsgränser</span>
        {hasEnergy && <span><i style={{ background: '#e08a2e' }} />HVDC-länk</span>}
        {hasEnergy && <span><i style={{ background: '#9aa5b1' }} />Planerad länk</span>}
        {hasFlow && <span><i style={{ background: '#2e9e5b' }} />Export</span>}
        {hasFlow && <span><i style={{ background: '#d4574a' }} />Import/motriktning</span>}
        {hasIx && <span><i className="pt" style={{ background: '#7c5cd6' }} />Internetutbyte (IX)</span>}
        {hasOsm && <span><i className="pt" style={{ background: '#e0662e' }} />Anläggning (OSM)</span>}
        {hasFartyg && <span><i className="pt" style={{ background: '#0f8b8d' }} />Fartyg (AIS)</span>}
        {hasFlowmatning && <span><i className="pt" style={{ background: '#e0a52e' }} />Flödesmätare (topp 25)</span>}
        {hasStation && <span><i className="pt" style={{ background: '#c2418f' }} />Järnvägsstation</span>}
        {hasKamera && <span><i className="pt" style={{ background: '#2f9e44' }} />Speedkamera (huvudvägar)</span>}
        {hasEvents && <span><i style={{ background: '#d4574a' }} />Trafikhändelse</span>}
      </div>
      {wx && (
        <div className="wxlegend mut">
          <span className="ramp" style={{ background: WX_RAMPS[wx.parameter]?.css }} />
          <span>
            {WX_RAMPS[wx.parameter]?.label ?? wx.parameter}
            {' '}({WX_RAMPS[wx.parameter]?.min}–{WX_RAMPS[wx.parameter]?.max}) ·
            nu-steg {fmtTime(wx.time)} · cykel {fmtTime(wx.createdTime)} · klicka för punktprognos
          </span>
        </div>
      )}
      {wxErr && (
        <div className="mut" style={{ color: 'var(--warn)', marginTop: 6 }}>
          Prognosrutnät: {wxErr}
        </div>
      )}
      {empty && (
        <div className="mut" style={{ fontSize: 12.5, marginTop: 6 }}>
          Inga dynamiska geolager just nu – OSM-extraktionen sker veckovis och
          vissa källor kräver nätverksåtkomst (se källstatus nedan). Landsgränser
          visas alltid; energilaget visas i område 1.
        </div>
      )}
      <div className="mut" style={{ fontSize: 12.5, marginTop: 6 }}>
        Kartunderlag © OpenStreetMap. Zonmittpunkter och länkar är schematiska
        (approximat). IX-punkter är placerade på stadsnivå (PeeringDB bär inte
        med koordinater); anläggningspunkter är OSM-koordinater.
      </div>
    </div>
  );
}
