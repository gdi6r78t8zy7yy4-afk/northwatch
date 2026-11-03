// Gemensam test-setup (M6):
//  – jest-dom-matcher (toBeInTheDocument m.fl.)
//  – deterministisk Leaflet-mock för alla testfiler
//  – rensning av DOM, Leaflet-logg och localStorage mellan test
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { __resetLeaflet } from './leafletMock.js';

// React 18: render/event måste skett i "act"-miljö.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('leaflet', () => import('./leafletMock.js'));

afterEach(() => {
  cleanup();
  __resetLeaflet();
  window.localStorage.clear();
});
