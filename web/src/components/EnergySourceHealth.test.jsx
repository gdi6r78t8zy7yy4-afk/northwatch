import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import EnergySourceHealth from './EnergySourceHealth.jsx';

describe('EnergySourceHealth', () => {
  test('shows collector status, cadence, run duration and separate last-run/last-success ages', () => {
    render(<EnergySourceHealth sources={[{
      id:'svk', name:'Svenska kraftnät', country:'SE', status:'ok',
      every:300, lastRun:'2026-11-07T10:00:00.000Z', lastOk:'2026-11-07T09:55:00.000Z',
      ms:842, records:12, error:null
    }]}/>);
    expect(screen.getByText('Svenska kraftnät')).toBeInTheDocument();
    expect(screen.getByText('5 min')).toBeInTheDocument();
    expect(screen.getByText('842 ms')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Last attempt')).toBeInTheDocument();
    expect(screen.getByText('Last success')).toBeInTheDocument();
    expect(document.querySelector('.energy-source-health-note').textContent).toContain('Collector run times describe Northwatch');
  });

  test('summarizes missing credentials and errors without hiding them', () => {
    render(<EnergySourceHealth sources={[
      {id:'fi',name:'Fingrid',country:'FI',status:'no_key',every:300,records:0,error:'Missing FINGRID_KEY'},
      {id:'no',name:'Statnett',country:'NO',status:'error',every:300,records:2,error:'HTTP 503'}
    ]}/>);
    expect(screen.getByText('1', {selector:'.energy-source-health-summary span:nth-child(4) b'})).toBeInTheDocument();
    expect(screen.getByText('HTTP 503')).toBeInTheDocument();
    expect(screen.getByText('Missing FINGRID_KEY')).toBeInTheDocument();
  });

  test('shows an empty-state message when no energy sources match the filter', () => {
    render(<EnergySourceHealth sources={[]}/>);
    expect(screen.getByText('No energy collectors are reporting in the selected scope.')).toBeInTheDocument();
  });
});
