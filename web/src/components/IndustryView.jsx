// M10: industrivy (område 7). Två parallella feeds (120 s-polling):
//   /api/industry/status  – beräknad poäng+drivfaktorer (per land eller NORDIC)
//   /api/industry/data    – underliggande records per källa för panelerna
// Landsvy (SE/NO/DK/FI/IS) visar dess lands per-källa-detalj; NORDIC/ALL visar
// sammanfattningen med per-land-tabell + luckkort (IEA, Stats Denmark, Comtrade
// key). Panelerna i IndustryPanels.jsx är presentationella.
import React from 'react';
import { fetchIndustryStatus, fetchIndustryData } from '../api.js';
import { useFeed } from './CyberBits.jsx';
import {
  IndustryStatusPanel, IndustryEurostatPanel, IndustrySteelPanel,
  IndustryComtradePanel, IndustryRmisPanel, IndustryNationalPanel, IndustryGapCards,
} from './IndustryPanels.jsx';

const NORDIC = ['SE', 'NO', 'DK', 'FI', 'IS'];

export default function IndustryView({ country }) {
  const c = NORDIC.includes(country) ? country : 'NORDIC';
  const national = c !== 'NORDIC';

  const statusFeed = useFeed(() => fetchIndustryStatus(c), 120000, [c]);
  const dataFeed = useFeed(() => fetchIndustryData(national ? c : 'ALL'), 120000, [c]);

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
      <IndustryStatusPanel
        status={statusFeed.data}
        meta={statusMeta}
        national={national}
      />
      <IndustryEurostatPanel records={bySource('eurostat-industry')} meta={dataMeta} />
      <IndustryNationalPanel records={bySourceNat(dataFeed.data)} meta={dataMeta} country={c} />
      <IndustrySteelPanel records={bySource('oecd')} meta={dataMeta} />
      <IndustryComtradePanel records={bySource('comtrade')} meta={dataMeta} />
      <IndustryRmisPanel records={bySource('rmis')} meta={dataMeta} />
      {!national && <IndustryGapCards />}
    </div>
  );
}

// Records från de fyra nationella statistikbyråerna (scb/ssb/statfinland/
// statice). null om datat felet (se bySource).
const NAT_IDS = ['scb', 'ssb', 'statfinland', 'statice'];
function bySourceNat(data) {
  return data?.records ? data.records.filter(r => NAT_IDS.includes(r.source)) : null;
}
