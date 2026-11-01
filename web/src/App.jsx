import React, { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import TopBar from './components/TopBar.jsx';
import SummaryPage from './pages/SummaryPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import { fetchDashboards } from './api.js';

function useLocalStorage(key, initial) {
  const [val, setVal] = useState(() => {
    try { return localStorage.getItem(key) ?? initial; } catch { return initial; }
  });
  const set = v => {
    setVal(v);
    try { localStorage.setItem(key, v); } catch { /* privat läge m.m. */ }
  };
  return [val, set];
}

export default function App() {
  const [areas, setAreas] = useState([]);
  const [gen, setGen] = useState(null);
  const [backendDown, setBackendDown] = useState(false);
  const [country, setCountry] = useLocalStorage('nw-country', 'ALL');

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const d = await fetchDashboards();
        if (stop) return;
        setAreas(d.areas);
        setGen(d.generatedAt);
        setBackendDown(false);
      } catch {
        if (!stop) setBackendDown(true);
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  return (
    <HashRouter>
      <TopBar areas={areas} gen={gen} backendDown={backendDown}
        country={country} setCountry={setCountry} />
      <main>
        <Routes>
          <Route path="/" element={<SummaryPage areas={areas} backendDown={backendDown} />} />
          <Route path="/d/:id" element={<DashboardPage country={country} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer>
        Northwatch · data från öppna API enligt API-katalogen · alla nycklar ligger i backend
      </footer>
    </HashRouter>
  );
}
