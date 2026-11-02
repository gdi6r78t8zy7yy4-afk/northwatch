// Interaktiv karta (M3): Leaflet + OSM-kartunderlag.
// Lager:
//   – landsgränser (statisk GeoJSON via backend, Natural Earth)
//   – energilagret: HVDC-länkar + schematiska zonskilda (område 1)
//   – zonflöden i realtid (Statnett, live-mittade MW)
//   – anläggningspunkter: IX (PeeringDB), OSM (kraft/datacenter/flyg/vatten),
//     Trafikverket flödesmätare (topp 25) + följda järnvägsstationer (M5)
//   – händelser med geografi (t.ex. Digitraffic vägtrafik, FI, Trafikverket)
// Allt servas av backend – frontend pratar aldrig med externa källor.
import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const NORDIC_CENTER = [64.5, 8];
const NORDIC_ZOOM = 4;

const TYPE_COLORS = {
  ix: '#7c5cd6',
  kraftanläggning: '#e0662e',
  datacenter: '#9b3fd4',
  flygplats: '#2e86c1',
  vattenverk: '#14b8a6',
  fartyg: '#0f8b8d',
  flowmatning: '#e0a52e',
  station: '#c2418f',
};

const TYPE_LABELS = {
  ix: 'Internetutbyte (IX)',
  kraftanläggning: 'Kraftanläggning / elnät (OSM)',
  datacenter: 'Datacenter (OSM)',
  flygplats: 'Flygplats (OSM)',
  vattenverk: 'Vattenverk (OSM)',
  fartyg: 'Fartyg i rörelse (AIS, Digitraffic Meri)',
  flow: 'Zonflöde (Statnett)',
  flowmatning: 'Flödesmätare (Trafikverket)',
  station: 'Järnvägsstation (Trafikverket)',
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

export default function MapPanel({ area, country, assets = [], staticGeo = null, events = [] }) {
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

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

  // Uppdatera datalagren vid förändring.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const sel = country === 'ALL' ? null : country;

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

    // Asset: punkter (IX, OSM) och linjer (Statnett-flöden).
    for (const a of assets) {
      const g = a.geometry;
      if (g?.type === 'Point') {
        const [lng, lat] = g.coordinates;
        L.circleMarker([lat, lng], {
          radius: a.type === 'ix' ? 4.5 : 3.5,
          color: '#fff', weight: 1,
          fillColor: TYPE_COLORS[a.type] ?? '#888',
          fillOpacity: 0.9,
        }).bindPopup(popupHtml(a), { maxWidth: 280 }).addTo(layer);
      } else if (g?.type === 'LineString') {
        const coords = g.coordinates.map(([lng, lat]) => [lat, lng]);
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

    // Utsikt: valt land, annars hela Norden.
    if (sel) {
      const feat = staticGeo?.countries?.features?.find(f => f.properties.code === sel);
      if (feat) {
        const b = L.geoJSON(feat).getBounds();
        if (b.isValid()) map.fitBounds(b.pad(0.08), { maxZoom: 7 });
        return;
      }
    }
    map.setView(NORDIC_CENTER, NORDIC_ZOOM);
  }, [area.id, country, assets, staticGeo, events]);

  const hasEnergy = area.id === 1;
  const hasIx = assets.some(a => a.type === 'ix');
  const hasOsm = assets.some(a => a.source === 'osm');
  const hasFlow = assets.some(a => a.type === 'flow');
  const hasFartyg = assets.some(a => a.type === 'fartyg');
  const hasFlowmatning = assets.some(a => a.type === 'flowmatning');
  const hasStation = assets.some(a => a.type === 'station');
  const hasEvents = events.length > 0;
  const empty = !hasIx && !hasOsm && !hasFlow && !hasFartyg && !hasFlowmatning && !hasStation && !hasEvents;

  return (
    <div className="card">
      <h2>Karta</h2>
      <div ref={divRef} className="mapbox" />
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
        {hasEvents && <span><i style={{ background: '#d4574a' }} />Trafikhändelse</span>}
      </div>
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
