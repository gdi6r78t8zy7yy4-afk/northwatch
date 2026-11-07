import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './style.css';

// Support direct browser URLs (e.g. /energy or /d/1) in production SPA hosting with HashRouter
if (typeof window !== 'undefined' && window.location.pathname && window.location.pathname !== '/' && (!window.location.hash || window.location.hash === '#/')) {
  const target = window.location.pathname.replace(/^\/+/, '/') + window.location.search;
  window.history.replaceState(null, '', '/#' + target);
}

createRoot(document.getElementById('root')).render(<App />);
