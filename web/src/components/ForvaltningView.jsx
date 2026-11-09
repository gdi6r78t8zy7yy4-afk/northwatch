// M11: förvaltningsvy (område 12). Två parallella feeds (120 s-polling):
//   /api/forvaltning/status – beräknat Förvaltningsindex (per land eller NORDIC)
//   /api/forvaltning/data   – underliggande records per källa för panelerna
// Landsvy (SE/NO/DK/FI/IS) visar dess lands nationella källa + de gemensamma
// (IPU, data.europa.eu, EUR-Lex); IS saknar nationell källa → luckkort.
// NORDIC/ALL visar sammanfattning + samtliga sju källor + luckkort.
// Panelerna i ForvaltningPanels.jsx är presentationella.
import React from 'react';
import { fetchForvaltningStatus, fetchForvaltningData } from '../api.js';
import { useFeed } from './CyberBits.jsx';
import {
  ForvaltningStatusPanel, RiksdagenPanel, FdkPanel, RetsinformationPanel,
  FinlexPanel, IpuPanel, DataportalPanel, CellarPanel,
  IslandGapCard, ForvaltningGapCards,
} from './ForvaltningPanels.jsx';

const NORDIC = ['SE', 'NO', 'DK', 'FI', 'IS'];

export default function ForvaltningView({ country }) {
  const c = NORDIC.includes(country) ? country : 'NORDIC';
  const national = c !== 'NORDIC';

  const statusFeed = useFeed(() => fetchForvaltningStatus(c), 120000, [c]);
  const dataFeed = useFeed(() => fetchForvaltningData(national ? c : 'ALL'), 120000, [c]);

  // dataFeed.data = null (fel/loading) → recordlistorna är null, så visarna
  // visar fel- respektive hämtar-läge i stället för tomtext.
  const bySource = id => {
    const all = dataFeed.data?.records;
    return all ? all.filter(r => r.source === id) : null;
  };
  const dataMeta = {
    loading: dataFeed.loading,
    error: dataFeed.error,
    fetchedAt: dataFeed.data?.generatedAt,
    onRetry: dataFeed.reload,
  };
  const statusMeta = {
    loading: statusFeed.loading,
    error: statusFeed.error,
    fetchedAt: statusFeed.data?.generatedAt,
    onRetry: statusFeed.reload,
  };

  return (
    <div className="industry-grid">
      <ForvaltningStatusPanel
        status={statusFeed.data}
        meta={statusMeta}
        national={national}
      />
      {(!national || c === 'SE') && <RiksdagenPanel records={bySource('riksdagen')} meta={dataMeta} />}
      {(!national || c === 'NO') && <FdkPanel records={bySource('fdk')} meta={dataMeta} />}
      {(!national || c === 'DK') && <RetsinformationPanel records={bySource('retsinformation')} meta={dataMeta} />}
      {(!national || c === 'FI') && <FinlexPanel records={bySource('finlex')} meta={dataMeta} />}
      {national && c === 'IS' && <IslandGapCard />}
      <IpuPanel records={bySource('ipu')} meta={dataMeta} />
      <DataportalPanel records={bySource('dataportal')} meta={dataMeta} />
      <CellarPanel records={bySource('cellar')} meta={dataMeta} />
      {!national && <ForvaltningGapCards />}
    </div>
  );
}
