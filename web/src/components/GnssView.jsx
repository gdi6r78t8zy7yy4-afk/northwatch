// M12: GNSS-/rymdvy (område 10). Två parallella feeds (120 s-polling):
//   /api/gnss/status – beräknat GNSS-index (per land eller NORDIC)
//   /api/gnss/data   – underliggande records per källa för panelerna
// Landsvy (SE/NO/DK/FI/IS) visar de globala källorna + nationella register
// (data.norge.no för NO); NORDIC/ALL visar allt + luckkort. Stationerna i
// kartan ovan renderas av MapPanel via /api/assets?area=10 (geo: true).
// Panelerna i GnssPanels.jsx är presentationella; korrelationspanelen pollar
// sin egen /api/gnss/correlation (async pga valfri LLM-berikelse i backenden).
import React from 'react';
import { fetchGnssStatus, fetchGnssData } from '../api.js';
import { useFeed } from './CyberBits.jsx';
import {
  GnssStatusPanel, NoaaPanel, CelestrakPanel, GscPanel, M3gPanel,
  DatanorgePanel, ApodPanel, GnssCorrelationPanel, GnssGapCards,
} from './GnssPanels.jsx';

const NORDIC = ['SE', 'NO', 'DK', 'FI', 'IS'];

export default function GnssView({ country }) {
  const c = NORDIC.includes(country) ? country : 'NORDIC';
  const national = c !== 'NORDIC';

  const statusFeed = useFeed(() => fetchGnssStatus(c), 120000, [c]);
  const dataFeed = useFeed(() => fetchGnssData(national ? c : 'ALL'), 120000, [c]);

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
      <GnssStatusPanel status={statusFeed.data} meta={statusMeta} national={national} />
      <NoaaPanel records={bySource('noaa')} meta={dataMeta} />
      <CelestrakPanel records={bySource('celestrak')} meta={dataMeta} />
      <GscPanel records={bySource('gsc-europa')} meta={dataMeta} />
      <M3gPanel records={bySource('gnss-metadata')} meta={dataMeta} />
      {(!national || c === 'NO') && <DatanorgePanel records={bySource('datanorge')} meta={dataMeta} />}
      <ApodPanel records={bySource('nasa-apod')} meta={dataMeta} />
      <GnssCorrelationPanel />
      {!national && <GnssGapCards />}
    </div>
  );
}
