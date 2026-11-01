// Statusmodell – gemensam för matris, kort och källhälsa.
export const STATUS = {
  ok:      { label: 'OK',            cls: 'st-ok' },
  stale:   { label: 'Föråldrad',     cls: 'st-warn' },
  no_key:  { label: 'Saknar nyckel', cls: 'st-warn' },
  error:   { label: 'Fel',           cls: 'st-err' },
  running: { label: 'Hämtar…',       cls: 'st-mut' },
  none:    { label: 'Ingen källa',   cls: 'st-none' },
};

export const statusMeta = st => STATUS[st] ?? STATUS.running;

// Värmefärg för matrisceller.
export const CELL_BG = {
  ok: 'var(--ok-bg)',
  stale: 'var(--warn-bg)',
  no_key: 'var(--warn-bg)',
  error: 'var(--err-bg)',
  running: 'var(--mut-bg)',
  none: 'var(--none-bg)',
};

export const COUNTRY_NAMES = {
  SE: 'Sverige', NO: 'Norge', DK: 'Danmark', FI: 'Finland', IS: 'Island',
  NORDIC: 'Nordiskt gemensamt', ALL: 'Alla länder',
};

export function fmtTime(ts) {
  if (!ts) return '–';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('sv-SE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtAge(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 90) return 'nyss';
  if (s < 3600) return Math.round(s / 60) + ' min sedan';
  if (s < 86400) return Math.round(s / 3600) + ' h sedan';
  return Math.round(s / 86400) + ' d sedan';
}
