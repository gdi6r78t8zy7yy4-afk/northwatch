// M12: gemensamma byggstenar för GNSS-/rymdpanelerna (område 10) – statusbadge
// med färgkodning per GNSS-index-label och komponentrader (tillgänglighet/
// stabilitet/varningstäthet/täckning). Poängskala, recordtabell och landsnamn
// återanvänds ur IndustryBits (M10); färgklasserna delar fv-* från M11. All
// data kommer via /api/gnss/* (backenden beräknar ur kollektornas records).
import React from 'react';
import { ScoreBar, RecordTable, countryLabel } from './IndustryBits.jsx';

// Label → färgklass. Hög driftssäkerhet = positiv (ok), Stabil drift = neutralt
// (accent), Uppmärksamhet = varning (warn), Svag = negativt (err), Okänt = okänd.
export const LABEL_CLS = {
  'Hög driftssäkerhet': 'fv-hog',
  'Stabil drift': 'fv-stab',
  Uppmärksamhet: 'fv-opp',
  Svag: 'fv-svag',
  Okänt: 'fv-unknown',
};

// Poängbadge med färgkodning efter label.
export function StatusBadge({ label }) {
  const cls = LABEL_CLS[label] ?? 'fv-unknown';
  return <span className={`ind-badge ${cls}`}>{label ?? 'Okänt'}</span>;
}

// Anomalie-/händelseallvarlighetsgrad → badgeklass (alert/warn/info).
export const SEV_BADGE_CLS = { alert: 'fv-svag', warn: 'fv-opp', info: 'fv-stab' };
export function SevBadge({ severity }) {
  return <span className={`ind-badge ${SEV_BADGE_CLS[severity] ?? 'fv-unknown'}`}>{severity ?? '–'}</span>;
}

// De fyra delscoreerna som poängrader. components: {tillgänglighet, stabilitet,
// varningstäthet, täckning} – saknad komponent = null (visas som '–').
export function ComponentRows({ components }) {
  const rows = [
    ['tillgänglighet', 'Tillgänglighet'],
    ['stabilitet', 'Stabilitet'],
    ['varningstäthet', 'Varningstäthet'],
    ['täckning', 'Täckning'],
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

export { ScoreBar, RecordTable, countryLabel };
