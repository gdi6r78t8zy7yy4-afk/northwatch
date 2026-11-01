import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import { COUNTRY_NAMES } from '../status.js';

export default function TopBar({ areas, gen, backendDown, country, setCountry }) {
  return (
    <div className="topbar">
      <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
        🛰️ Northwatch <span className="sub">· Nordisk kritisk infrastruktur</span>
      </Link>
      <nav className="nav">
        <NavLink to="/" end>Översikt</NavLink>
        {areas.map(a => (
          <NavLink key={a.id} to={`/d/${a.id}`}>{a.id}. {a.short}</NavLink>
        ))}
      </nav>
      <div className="topright">
        {backendDown && <span className="pill st-err">Backend ej nåbar</span>}
        {gen && <span>uppdaterad {new Date(gen).toLocaleTimeString('sv-SE')}</span>}
        <label>
          Område:{' '}
          <select value={country} onChange={e => setCountry(e.target.value)}>
            <option value="ALL">Alla länder</option>
            {Object.entries(COUNTRY_NAMES)
              .filter(([k]) => !['NORDIC', 'ALL'].includes(k))
              .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}
