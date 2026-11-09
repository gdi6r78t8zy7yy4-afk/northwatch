// M11: gemensamma byggstenar för förvaltningspanelerna (område 12) –
// statusbadge med färgkodning per Förvaltningsindex-label, komponentrader
// (aktivitet/kontinuitet/observerbarhet) och per-källa-sektion. Poängskala,
// recordtabell och landsnamn återanvänds ur IndustryBits (M10). All data
// kommer via /api/forvaltning/* (backenden beräknar ur kollektornas records).
import React from 'react';
import { ScoreBar, RecordTable, countryLabel } from './IndustryBits.jsx';

// Label → färgklass. Hög trygghet = positiv (ok), Stabilt = neutralt (accent),
// Uppmärksamhet = varning (warn), Svag = negativt (err), Okänt = ej klassifierbart.
export const LABEL_CLS = {
  'Hög trygghet': 'fv-hog',
  Stabilt: 'fv-stab',
  Uppmärksamhet: 'fv-opp',
  Svag: 'fv-svag',
  Okänt: 'fv-unknown',
};

// Poängbadge med färgkodning efter label.
export function StatusBadge({ label }) {
  const cls = LABEL_CLS[label] ?? 'fv-unknown';
  return <span className={`ind-badge ${cls}`}>{label ?? 'Okänt'}</span>;
}

// De tre delscoreerna som poängrader. components: {aktivitet, kontinuitet, observerbarhet}.
export function ComponentRows({ components }) {
  const rows = [
    ['aktivitet', 'Aktivitet'],
    ['kontinuitet', 'Kontinuitet'],
    ['observerbarhet', 'Observerbarhet'],
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

// Rubriksektion inom en panel (t.ex. per land i IPU- eller portalpanelen).
export function SectionHead({ children, sub }) {
  return (
    <div className="fv-section-head">
      <h3>{children}</h3>
      {sub ? <div className="mut">{sub}</div> : null}
    </div>
  );
}

export { ScoreBar, RecordTable, countryLabel };
