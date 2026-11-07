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

function detailValue(value) {
  if (value == null || value === '') return 'Ej tillgängligt';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function itemDetailRows(item) {
  const rows = [];
  for (const [key, value] of Object.entries(item ?? {})) {
    if (['key', 'attrs', 'geometry', 'geo', 'properties'].includes(key)) continue;
    if (value != null && value !== '') rows.push([key, detailValue(value)]);
  }
  for (const [key, value] of Object.entries(item?.properties ?? {})) {
    if (value != null && value !== '') rows.push([key, detailValue(value)]);
  }
  for (const [key, value] of Object.entries(item?.attrs ?? {})) {
    if (value != null && value !== '') rows.push([key, detailValue(value)]);
  }
  const geometry = item?.geometry ?? item?.geo;
  if (geometry) {
    rows.push(['Geometrityp', geometry.type ?? 'Okänd']);
    if (geometry.type === 'Point' && geometry.coordinates) {
      rows.push(['Koordinater (lon, lat)', geometry.coordinates.join(', ')]);
    } else if (Array.isArray(geometry.coordinates)) {
      rows.push(['Geometripunkter', String(geometry.coordinates.length)]);
      rows.push(['Startkoordinat', detailValue(geometry.coordinates[0])]);
      rows.push(['Slutkoordinat', detailValue(geometry.coordinates.at(-1))]);
    }
  }
  return rows;
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
  const [energyLayers, setEnergyLayers] = useState({ zones: true, links: true, flows: true });
  const [selectedItem, setSelectedItem] = useState(null);

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
        if (p.kind === 'zone' && energyLayers.zones) {
          const [lng, lat] = f.geometry.coordinates;
          L.circleMarker([lat, lng], {
            radius: 7, color: '#07111c', weight: 2.5, fillColor: '#f6c85f', fillOpacity: 1,
          }).bindTooltip(p.zone, {
            permanent: true, direction: 'auto', offset: [0, -12], className: 'zone-label',
          }).on('click', () => setSelectedItem({
            key: `zone:${p.zone}`, name: p.zone, type: 'Elområde', source: 'Northwatch / schematisk geodata',
            properties: p, geometry: f.geometry,
          })).addTo(layer);
        } else if (p.kind === 'link' && energyLayers.links) {
          const coords = f.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
          const planned = p.status === 'planerad';
          const link = L.polyline(coords, {
            color: '#07111c', weight: 8, opacity: 0.9, dashArray: planned ? '8 7' : null,
          });
          link.addTo(layer);
          L.polyline(coords, {
            color: planned ? '#d5e0eb' : '#ffb454',
            weight: 4, dashArray: planned ? '7 7' : null, opacity: 1,
          }).bindTooltip(`${p.name} · ${p.mw ?? '—'} MW · ${p.status ?? 'status okänd'}${p.note ? ` · ${p.note}` : ''}`, {
            sticky: true, direction: 'auto', className: 'map-item-tooltip',
          }).on('click', () => setSelectedItem({
            key: `link:${p.name}`, name: p.name ?? 'HVDC-länk', type: 'HVDC-länk',
            source: 'Northwatch / schematisk geodata', properties: p, geometry: f.geometry,
          })).addTo(layer);
        }
      }
    }

    // Asset: punkter (IX, OSM) och linjer (Statnett/SVK-flöden).
    for (const a of assets) {
      if (area.id === 1 && a.type === 'flow' && !energyLayers.flows) continue;
      const g = a.geometry;
      if (g?.type === 'Point') {
        const [lng, lat] = g.coordinates;
        L.circleMarker([lat, lng], {
          radius: a.type === 'kamera' ? 4 : a.type === 'ix' ? 7 : 6,
          color: '#07111c', weight: 2.5,
          fillColor: TYPE_COLORS[a.type] ?? '#a8b8c8',
          fillOpacity: 1,
        }).bindPopup(popupHtml(a), { maxWidth: 280 })
          .bindTooltip(a.name, { direction: 'auto', sticky: true, offset: [0, -10], className: 'map-item-tooltip' })
          .on('click', () => setSelectedItem({
            ...a, key: `asset:${a.id ?? a.name}`, typeLabel: TYPE_LABELS[a.type] ?? a.type,
          })).addTo(layer);
      } else if (g?.type === 'LineString') {
        const coords = a.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        const mw = a.attrs?.mw;
        const color = a.type === 'flow' ? (mw >= 0 ? '#2e9e5b' : '#d4574a') : '#e08a2e';
        // Signed flow values reverse the direction of the visible arrow.
        const directed = a.type === 'flow' && Number(mw) < 0 ? [...coords].reverse() : coords;
        const flowLabel = a.type === 'flow'
          ? `${Number(mw) < 0 ? (a.attrs?.to ?? '') : (a.attrs?.from ?? '')} → ${Number(mw) < 0 ? (a.attrs?.from ?? '') : (a.attrs?.to ?? '')} · ${Math.round(Math.abs(mw))} MW`
          : a.name;
        L.polyline(directed, { color: '#07111c', weight: a.type === 'flow' ? 8 : 6, opacity: 0.95 }).addTo(layer);
        L.polyline(directed, {
          color, weight: a.type === 'flow' ? 4 + Math.min(2, Math.abs(mw ?? 0) / 700) : 3,
          opacity: 1, lineCap: 'round', lineJoin: 'round',
        }).bindTooltip(flowLabel, { sticky: true, direction: 'auto', className: 'map-item-tooltip' })
          .on('click', () => setSelectedItem({
            ...a, key: `asset:${a.id ?? a.name}`, typeLabel: TYPE_LABELS[a.type] ?? a.type,
            geometry: a.geometry,
          })).addTo(layer);
        if (a.type === 'flow' && directed.length >= 2 && typeof map.latLngToLayerPoint === 'function') {
          const start = map.latLngToLayerPoint(directed[0]);
          const finish = map.latLngToLayerPoint(directed[directed.length - 1]);
          const angle = Math.atan2(finish.y - start.y, finish.x - start.x);
          const midpoint = [(directed[0][0] + directed[directed.length - 1][0]) / 2,
            (directed[0][1] + directed[directed.length - 1][1]) / 2];
          L.marker(midpoint, { interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'flow-direction-icon',
              html: `<span style="transform:rotate(${angle}rad)">➤</span>`,
              iconSize: [24, 24], iconAnchor: [12, 12] }),
          }).addTo(layer);
        }
      }
    }

    // Händelser med geografi (t.ex. Digitraffic MultiLineString).
    for (const ev of events) {
      if (!ev.geo) continue;
      const feat = { type: 'Feature', properties: { title: ev.title }, geometry: ev.geo };
      L.geoJSON(feat, {
        style: { color: '#07111c', weight: 8, opacity: 0.95 },
        onEachFeature: (f, l) => {
          l.bindTooltip(f.properties.title, { sticky: true, direction: 'auto', className: 'map-item-tooltip' });
          l.on('click', () => setSelectedItem({
            key: `event:${ev.id ?? ev.title}`, name: ev.title, type: 'Geografisk händelse',
            source: ev.source ?? 'Händelseflöde', ...ev,
          }));
        },
      }).addTo(layer);
    }
  }, [area.id, country, assets, staticGeo, events, wx, energyLayers]);

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
          {hasEnergy && <span className="map-layer-controls" role="group" aria-label="Energilager">
            <button type="button" aria-pressed={energyLayers.zones} className={energyLayers.zones ? 'on' : ''}
              onClick={() => setEnergyLayers(v => ({ ...v, zones: !v.zones }))}>Zoner</button>
            <button type="button" aria-pressed={energyLayers.links} className={energyLayers.links ? 'on' : ''}
              onClick={() => setEnergyLayers(v => ({ ...v, links: !v.links }))}>HVDC</button>
            <button type="button" aria-pressed={energyLayers.flows} className={energyLayers.flows ? 'on' : ''}
              onClick={() => setEnergyLayers(v => ({ ...v, flows: !v.flows }))}>Liveflöden</button>
          </span>}
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
      <div className="map-workspace">
        <div ref={divRef} className="mapbox" style={{ height: MAP_SIZES[size] }} />
        <aside className="map-item-inspector" aria-label="Information om valt kartobjekt" aria-live="polite">
          {selectedItem ? <>
            <div className="map-item-inspector-head">
              <div><span>VALT KARTOBJEKT</span><h3>{selectedItem.name ?? selectedItem.title ?? 'Namnlöst objekt'}</h3></div>
              <button type="button" className="map-item-clear" onClick={() => setSelectedItem(null)} aria-label="Stäng objektinformation">×</button>
            </div>
            <div className="map-item-type">{selectedItem.typeLabel ?? selectedItem.type ?? 'Kartobjekt'}{selectedItem.source ? ` · ${selectedItem.source}` : ''}</div>
            <dl className="map-item-details">
              {itemDetailRows(selectedItem).map(([key, value], index) => (
                <div key={`${key}-${index}`}><dt>{key}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </> : <div className="map-item-empty">
            <span>OBJEKTINSPEKTÖR</span><b>Välj ett objekt på kartan</b>
            <p>Klicka på en anläggning, ledning, zon eller händelse för att visa tillgängliga uppgifter här.</p>
          </div>}
        </aside>
      </div>
      <div className="maplegend mut">
        <span><i style={{ background: '#4a7fd4' }} />Landsgränser</span>
        {hasEnergy && energyLayers.zones && <span><i className="pt" style={{ background: '#5b6470' }} />Elområden</span>}
        {hasEnergy && energyLayers.links && <span><i style={{ background: '#e08a2e' }} />HVDC-länk</span>}
        {hasEnergy && energyLayers.links && <span><i style={{ background: '#9aa5b1' }} />Planerad länk</span>}
        {hasFlow && energyLayers.flows && <span><i style={{ background: '#2e9e5b' }} />Export</span>}
        {hasFlow && energyLayers.flows && <span><i style={{ background: '#d4574a' }} />Import/motriktning</span>}
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
