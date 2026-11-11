import React, { useEffect, useMemo, useRef, useState } from 'react';
import { fmtTime } from '../status.js';
import TrendChart from './TrendChart.jsx';
import { selectDetailSeries, caveatOf } from '../lib/energyWidgets.js';

export const HISTORY_RANGES = [
  { id: '6h', label: '6 h' },
  { id: '24h', label: '24 h' },
  { id: '7d', label: '7 d' },
  { id: '30d', label: '30 d' },
];

// Fokusfälla: Tabbning hålls inom dialogen och Esc stänger. Förutsättningen
// sparas och återställs vid stängning så klicket på widgetkortet inte tappar
// fokus till <body>.
function useFocusTrap(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const previous = document.activeElement;
    (dialog.querySelector('[data-autofocus]') ?? dialog).focus();
    const onKeyDown = event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusables = [...dialog.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])',
      )].filter(el => !el.closest('[inert]'));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener('keydown', onKeyDown);
    const scroll = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = scroll;
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [onClose]);
  return ref;
}

// En enda återanvändlig modalförstoring för alla widgets: tidsväljare,
// trendgrafer ur det gemensamma historikarkivet, råa observationer och
// källmetadata. Widgets utan serier (karta, källor, analys) renderar egen
// content via children.
export default function WidgetDetailModal({ widget, item = null, country, getSeries, observations = [], onClose, children }) {
  const [range, setRange] = useState('24h');
  const [series, setSeries] = useState(null);
  const [error, setError] = useState(null);
  const dialogRef = useFocusTrap(onClose);

  useEffect(() => {
    if (!getSeries) return undefined;
    let stopped = false;
    setSeries(null); setError(null);
    getSeries(range).then(rows => { if (!stopped) setSeries(rows ?? []); })
      .catch(e => { if (!stopped) setError(e.message ?? 'Kunde inte hämta historik'); });
    return () => { stopped = true; };
  }, [getSeries, range]);

  const charts = useMemo(() => selectDetailSeries(widget.id, series ?? [], { country, item: item?.id }),
    [widget.id, series, country, item?.id]);
  const caveats = caveatOf(widget.id);
  const hasCharts = Boolean(getSeries);

  return <div className="nw-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="nw-modal" role="dialog" aria-modal="true" aria-label={`${widget.title} – detaljer`} tabIndex={-1} ref={dialogRef}>
      <header className="nw-modal-head">
        <div>
          <h2>{widget.title}{item ? <> · {item.label}</> : null}</h2>
          <p className="mut">{widget.hint} · {country === 'ALL' ? 'Alla länder' : country}</p>
        </div>
        <button type="button" className="nw-modal-close" aria-label="Stäng" data-autofocus onClick={onClose}>✕</button>
      </header>

      {hasCharts ? <>
        <div className="nw-range-switch" role="group" aria-label="Tidsintervall">
          {HISTORY_RANGES.map(r => <button type="button" key={r.id}
            className={'nw-range-btn' + (range === r.id ? ' on' : '')}
            aria-pressed={range === r.id} onClick={() => setRange(r.id)}>{r.label}</button>)}
        </div>

        {error ? <p className="mut">Historiken kunde inte hämtas: {error}</p> : null}
        {!series && !error ? <p className="mut">Hämtar historik…</p> : null}
        {series?.length === 0 ? <p className="mut">Inga historiserade serier matchar detta urval – ingen data har hunnit samlas in eller källan saknas i urvalet.</p> : null}
        {charts.length ? <div className="energy-chart-grid nw-modal-charts">{charts.map(s =>
          <TrendChart key={[s.country, s.source, s.indicator, s.unit].join('|')} series={s}/>)}</div>
          : !error && !series?.length ? null
          : <p className="mut">Inga serier matchar valet i detta tidsfönster.</p>}

        {observations.length ? <>
          <h3 className="nw-modal-subhead">Råa observationer</h3>
          <div className="energy-table-wrap"><table>
            <thead><tr><th>Mätvärde</th><th>Värde</th><th>Källa</th><th>Mättid (UTC)</th></tr></thead>
            <tbody>{observations.map((row, i) => <tr key={`${row.indicator}-${row.ts}-${i}`}>
              <td><b>{row.indicator}</b><div className="mut">{row.country} · {row.sourceName ?? row.source}</div></td>
              <td className="mono">{Number(row.value).toLocaleString('sv-SE', { maximumFractionDigits: 4 })} {row.unit}</td>
              <td>{row.sourceName ?? row.source}</td>
              <td>{fmtTime(row.ts)}</td>
            </tr>)}</tbody>
          </table></div>
        </> : null}
      </> : children}

      {caveats.length ? <>
        <h3 className="nw-modal-subhead">Datatolkning</h3>
        <ul className="nw-modal-caveats">{caveats.map((text, i) => <li key={i}>{text}</li>)}</ul>
      </> : null}
    </div>
  </div>;
}
