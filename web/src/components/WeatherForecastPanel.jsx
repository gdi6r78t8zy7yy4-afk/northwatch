// M8: SMHI väderprognospanel (område 11). Visar den aktuella cykelns
// tidsserier för en valt stad eller valfri plats (klick på kartan):
// temperatur, vind/byar, nederbörd, åska/isrisk, tryck/fuktighet –
// handgjorda SVG-grafer (ForecastChart) med gemensam tidsskrov.
//
// Data via backend /api/forecast/* (backend pratar med SMHI). 9999 och
// -9 (ingen nederbörd) renderas som saknade värden.
import React, { useEffect, useMemo, useState } from 'react';
import { fetchForecastPoint } from '../api.js';
import { fmtTime, COUNTRY_NAMES } from '../status.js';
import { symbolLabel, ptypeLabel, compass } from '../lib/symbolCodes.js';
import { nowIndex, MISSING } from '../lib/wxGrid.js';
import ForecastChart from './ForecastChart.jsx';

// Trösklar som drivs av deriveEvents på servern (samma gränser).
const TH_STORM_ORANGE = 17;   // m/s
const TH_STORM_RED = 22.5;    // m/s
const TH_TEMP_ORANGE = -15;   // °C
const TH_THUNDER = 60;        // %
const TH_FROZEN = 50;         // %

// 9999 / -9 / null → null (saknad); annars originalet.
function val(step, p) {
  const v = step?.data?.[p];
  if (v == null || v === MISSING) return null;
  return v;
}

const F1 = v => (v == null ? '–' : `${Math.round(v * 10) / 10}`);

export default function WeatherForecastPanel({ meta = null, customPoint = null, onClearCustom }) {
  const [city, setCity] = useState(null);
  const [point, setPoint] = useState(null); // 200-svarskroppen
  const [pointErr, setPointErr] = useState(null);
  const [hover, setHover] = useState(null);

  const ready = !!meta?.ready;
  const catalog = meta?.points ?? [];
  const selected = customPoint
    ?? catalog.find(p => p.name === city)
    ?? null;

  // Först val: första katalogpunkten inom domänen (Reykjavik → utanför).
  useEffect(() => {
    if (customPoint || !ready || city) return;
    const first = catalog.find(p => !p.outsideDomain);
    if (first) setCity(first.name);
  }, [customPoint, ready, city, catalog]);

  // Punktprognos: vid byte av plats/cykel + var 30:e sekund.
  useEffect(() => {
    if (!ready || !selected) { setPoint(null); return undefined; }
    let stop = false;
    const load = async () => {
      try {
        const r = customPoint
          ? await fetchForecastPoint({ lat: customPoint.lat, lon: customPoint.lon })
          : await fetchForecastPoint({ name: selected.name });
        if (stop) return;
        if (r.ok && r.body?.timeSeries?.length) {
          setPoint(r.body);
          setPointErr(null);
        } else {
          setPoint(null);
          setPointErr(r.body?.error ?? `HTTP ${r.status}`);
        }
      } catch (e) {
        if (!stop) { setPoint(null); setPointErr(e.message); }
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selected?.name, selected?.lat, selected?.lon, customPoint, meta?.createdTime]);

  // Nollställ tidsskroven när plats/cykel byts.
  useEffect(() => { setHover(null); }, [point?.createdTime, selected?.name, customPoint]);

  const data = useMemo(() => {
    if (!point?.timeSeries?.length) return null;
    const n = point.times.length;
    const get = p => point.timeSeries.map(s => val(s, p));
    return {
      times: point.times,
      i0: nowIndex(point.times),
      temp: get('air_temperature'),
      wind: get('wind_speed'),
      gust: get('wind_speed_of_gust'),
      prec: get('precipitation_amount_mean'),
      precMax: get('precipitation_amount_max'),
      thunder: get('thunderstorm_probability'),
      frozen: get('probability_of_frozen_precipitation'),
      pres: get('air_pressure_at_mean_sea_level'),
      hum: get('relative_humidity'),
    };
  }, [point]);

  // Gemensamma akseticks – alla grafer får samma x-rytm.
  const tickIdx = useMemo(() => {
    const n = data?.times.length ?? 0;
    if (n < 2) return n === 1 ? [0] : [];
    const count = Math.min(7, n);
    const out = new Set();
    for (let k = 0; k < count; k += 1) out.add(Math.round((k * (n - 1)) / (count - 1)));
    return [...out].sort((a, b) => a - b);
  }, [data]);

  const n = data?.times.length ?? 0;
  const hoverI = data ? (hover == null ? data.i0 : Math.max(0, Math.min(n - 1, hover))) : 0;
  const step = data ? point.timeSeries[hoverI] : null;

  if (!meta) {
    return (
      <div className="card">
        <h2>Väderprognos (SMHI snow1g)</h2>
        <div className="mut">Hämtar prognosstatus…</div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="card">
        <h2>Väderprognos (SMHI snow1g)</h2>
        <div className="mut">
          Väntar på första prognoscykeln – SMHI släpper en ny cykel ~varje timme.
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>
        Väderprognos (SMHI snow1g)
        <span className="maptools">
          {customPoint ? (
            <>
              <span className="tag">📍 {customPoint.name}</span>
              {onClearCustom && (
                <button type="button" className="tbtn" onClick={onClearCustom}
                  title="Tillbaka till katalogstäderna">
                  ✕
                </button>
              )}
            </>
          ) : (
            <select
              value={city ?? ''}
              onChange={e => setCity(e.target.value)}
              aria-label="Val av stad"
            >
              {catalog.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name}{p.outsideDomain ? ' (utanför domänen)' : ''}
                </option>
              ))}
            </select>
          )}
        </span>
      </h2>

      {selected && (
        <div className="mut">
          Cykel skapad {fmtTime(point?.createdTime ?? meta.createdTime)} · referens {fmtTime(point?.referenceTime ?? meta.referenceTime)}
          {' '}· {n} timsteg{selected.country && selected.country !== 'NORDIC'
            ? <> · {COUNTRY_NAMES[selected.country] ?? selected.country}</> : null}
          {' '}· klicka på kartan för valfri plats
        </div>
      )}

      {!selected && <div className="mut">Ingen plats vald.</div>}

      {selected && pointErr && (
        <div className="mut" style={{ color: 'var(--warn)', marginTop: 8 }}>{pointErr}</div>
      )}

      {selected && !point && !pointErr && (
        <div className="mut" style={{ marginTop: 8 }}>Hämtar prognos för {selected.name}…</div>
      )}

      {data && (
        <>
          <div className="fscrub">
            <input
              type="range"
              min="0"
              max={Math.max(0, n - 1)}
              step="1"
              value={hoverI}
              onChange={e => setHover(Number(e.target.value))}
              aria-label="Tidssteg i prognosen"
            />
            <span className="mono">{fmtTime(data.times[hoverI])}</span>
            {hover != null && (
              <button type="button" className="tbtn" onClick={() => setHover(null)}>Nu</button>
            )}
          </div>

          {step && (
            <div className="fcond">
              <span><b>{symbolLabel(val(step, 'symbol_code'))}</b> {ptypeLabel(val(step, 'predominant_precipitation_type_at_surface'))}</span>
              <span className="mono">
                {F1(val(step, 'air_temperature'))} °C ·
                {' '}vind {F1(val(step, 'wind_speed'))} m/s {F1(val(step, 'wind_speed_of_gust'))} <span title="Vindfrånriktning">({compass(val(step, 'wind_from_direction'))})</span>
              </span>
              <span className="mono">
                {F1(val(step, 'precipitation_amount_mean'))} mm/int (max {F1(val(step, 'precipitation_amount_max'))})
              </span>
              <span className="mono">
                tryck {F1(val(step, 'air_pressure_at_mean_sea_level'))} hPa · fukt {F1(val(step, 'relative_humidity'))} % · vis {F1(val(step, 'visibility_in_air'))} km
              </span>
              <span className="mono">
                åska {F1(val(step, 'thunderstorm_probability'))} % · ris. is-nederbörd {F1(val(step, 'probability_of_frozen_precipitation'))} %
              </span>
            </div>
          )}

          <ForecastChart
            title="Temperatur" unit="°C"
            times={data.times}
            series={[{ label: 'Temperatur', values: data.temp, color: '#d4574a' }]}
            hover={hoverI} onHover={setHover} nowIdx={data.i0} ticks={tickIdx}
            thresholds={[{ value: TH_TEMP_ORANGE, label: `≤ ${TH_TEMP_ORANGE} (orange)`, color: '#e0a52e' }]}
          />
          <ForecastChart
            title="Vind och byar" unit="m/s"
            times={data.times}
            series={[
              { label: 'Vind', values: data.wind, color: '#2563a8' },
              { label: 'Byar', values: data.gust, color: '#d4574a', dashed: true },
            ]}
            hover={hoverI} onHover={setHover} nowIdx={data.i0} ticks={tickIdx}
            thresholds={[
              { value: TH_STORM_ORANGE, label: `≥ ${TH_STORM_ORANGE} (orange)`, color: '#e0a52e' },
              { value: TH_STORM_RED, label: `≥ ${TH_STORM_RED} (röd)`, color: '#c0392b' },
            ]}
          />
          <ForecastChart
            title="Nederbörd (intervallsumma 1–12 h)" unit="mm"
            times={data.times}
            series={[
              { label: 'Medelvärde', values: data.prec, color: '#2e86c1' },
              { label: 'Max', values: data.precMax, color: '#6b5cd6', dashed: true },
            ]}
            hover={hoverI} onHover={setHover} nowIdx={data.i0} ticks={tickIdx}
          />
          <ForecastChart
            title="Åska och is-nederbörd" unit="%"
            times={data.times}
            series={[
              { label: 'Åska', values: data.thunder, color: '#b7791f' },
              { label: 'Is-nederbörd', values: data.frozen, color: '#7a3b8f', dashed: true },
            ]}
            hover={hoverI} onHover={setHover} nowIdx={data.i0} ticks={tickIdx}
            valueFmt={v => String(Math.round(v))}
            thresholds={[
              { value: TH_THUNDER, label: `≥ ${TH_THUNDER} % (gul)`, color: '#e0b050' },
              { value: TH_FROZEN, label: `≥ ${TH_FROZEN} % (gul)`, color: '#9b3fd4' },
            ]}
          />
          <div className="fchart2">
            <ForecastChart
              title="Tryck" unit="hPa" height={120}
              times={data.times}
              series={[{ label: 'Tryck (havsnivå)', values: data.pres, color: '#5b6470' }]}
              hover={hoverI} onHover={setHover} nowIdx={data.i0} ticks={tickIdx}
              valueFmt={v => String(Math.round(v))}
            />
            <ForecastChart
              title="Fuktighet" unit="%" height={120}
              times={data.times}
              series={[{ label: 'Relativ fuktighet', values: data.hum, color: '#14b8a6' }]}
              hover={hoverI} onHover={setHover} nowIdx={data.i0} ticks={tickIdx}
              valueFmt={v => String(Math.round(v))}
            />
          </div>
        </>
      )}
    </div>
  );
}
