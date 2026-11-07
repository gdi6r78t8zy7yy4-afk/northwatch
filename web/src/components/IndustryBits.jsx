// M10: gemensamma byggstenar för industripanelerna (område 7) – statusbadge
// med färgkodning per label, 0–100-poängskala, komponentrader (produktion/
// handel/kapacitet) och en liten recordtabell. All data kommer via
// /api/industry/* (backenden beräknar ur kollektornas records).
import React from 'react';
import { COUNTRY_NAMES } from '../status.js';

// Label → färgklass. Expansiv = positiv (ok), Stabilt = neutralt (accent),
// Kontraktion = negativt (err), Okänt = ej klassificerbar.
export const LABEL_CLS = {
  Expansiv: 'ind-exp',
  Stabilt: 'ind-stab',
  Kontraktion: 'ind-kon',
  Okänt: 'ind-unknown',
};

// NORDIC: COUNTRY_NAMES har 'Nordiskt gemensamt' (för rubriktaggen), men i
// tabell- och radkontext är 'Nordiskt' tydligare.
export const countryLabel = c => (c === 'NORDIC' ? 'Nordiskt' : COUNTRY_NAMES[c] ?? c);

// Poängbadge med färgkodning efter label.
export function StatusBadge({ label }) {
  const cls = LABEL_CLS[label] ?? 'ind-unknown';
  return <span className={`ind-badge ${cls}`}>{label ?? 'Okänt'}</span>;
}

// 0–100-skala med markör på 50 (neutralt). score=null → '–'.
export function ScoreBar({ score }) {
  if (score == null) return <span className="mut">–</span>;
  const w = Math.max(0, Math.min(100, score));
  return (
    <span className="ind-scorebar">
      <span className="track">
        <span className="fill" style={{ width: `${w}%` }} />
        <span className="mid" />
      </span>
      <span className="n mono">{score}</span>
    </span>
  );
}

// De tre komponenterna som poängrader. components: {production, trade, capacity}.
export function ComponentRows({ components }) {
  const rows = [
    ['production', 'Produktion'],
    ['trade', 'Handel'],
    ['capacity', 'Kapacitet'],
  ];
  return (
    <div className="ind-components">
      {rows.map(([key, label]) => {
        const c = components?.[key];
        return (
          <div className="ind-comp" key={key} title={c?.basis}>
            <span className="lbl">{label}</span>
            <ScoreBar score={c?.score ?? null} />
          </div>
        );
      })}
    </div>
  );
}

// Liten recordtabell: indikator, värde, enhet, period.
export function RecordTable({ records, empty = 'Ingen data ännu.', max = 30 }) {
  const rows = (records ?? []).filter(r => r.t !== 'e').slice(0, max);
  if (!rows.length) return <div className="mut">{empty}</div>;
  return (
    <table>
      <thead>
        <tr><th>Indikator</th><th>Värde</th><th>Enhet</th><th>Period</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.indicator}</td>
            <td className="mono">{r.value ?? '–'}</td>
            <td className="mut">{r.unit || '–'}</td>
            <td className="mono">{r.ts ?? '–'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
