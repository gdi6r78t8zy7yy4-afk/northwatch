import React from 'react';
import { statusMeta } from '../status.js';

export default function StatusPill({ status }) {
  const m = statusMeta(status);
  return <span className={`pill ${m.cls}`}>{m.label}</span>;
}
