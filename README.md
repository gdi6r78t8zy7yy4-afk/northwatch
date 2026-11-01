# Northwatch

Dashboard-ramverk för att visa **kritisk nätverksinfrastruktur i Norden** (SE, NO, DK, FI, IS).
En backend insamlar data från öppna API (statisk konfigurationsdata + realtidsmonitorering),
normaliserar den och exponerar den via en API-yta – en frontend (React) presenterar data per
dashboardområde med interaktiva kartor.

**Alla API-nyckler och kredensials ligger enbart i backend (`.env`) och visas aldrig i frontend.**

## Start

```bash
npm install
npm --prefix web install
cp .env.example .env   # fyll i CONTACT + ev. nycklar
npm run dev            # backend :3000 + Vite :5173 (öppna http://localhost:5173)
```

Produktionsläge (backend serverar den byggda fronten):

```bash
npm run build
npm start              # http://localhost:3000
```

## Områden (enligt API-katalogen)

| # | Område | # | Område |
|---|--------|---|--------|
| 1 | Elförsörjning och energisystem | 7 | Industri, tillverkning och försörjningskedjor |
| 2 | Elektronisk kommunikation och digital infrastruktur | 8 | Livsmedel och jordbruk |
| 3 | Transport och logistik | 9 | Finans och betalningssystem |
| 4 | Vatten och avloppshantering | 10 | Rymd, navigation och positionering |
| 5 | Cybersäkerhet och digitala hot | 11 | Miljö, naturhändelser och klimatpåverkan |
| 6 | Hälso- och sjukvård | 12 | Offentlig förvaltning och samhällsberedskap |

Översiktssidan (`#/`) visar status för alla områden per land; varje område har sin sida
(`#/d/1` … `#/d/12`) med gemensam mall: karta (där tillämpbart), indikatorer, händelser,
källhälsa och kända luckor. Landsskick väljs i toppraden (sparas i webbläsaren).

## Arkitektur

```
server/                 backend – inga runtime-beroenden (Node >= 20.6)
  app.js                HTTP: /api/* + statisk servering av web/dist
  areas.js              de 12 dashboardområdena (namn, scope, luckor, geo-flagga)
  lib/env.js            läser .env
  lib/http.js           fetch-hjälp (User-Agent med kontakt, timeout)
  lib/store.js          minneslager: normaliserade poster + källhälsa
  lib/scheduler.js      pollar varje källa med sitt intervall (staggerad uppstart)
  collectors/*.js       en modul per källa → normaliserade poster
web/                    Vite + React SPA (svenskt gränssnitt)
  src/App.jsx           routing (HashRouter), globalt landsskick, 30 s-refresh
  src/pages/            SummaryPage (statusmatris), DashboardPage (gemensam mall)
  src/components/       TopBar, StatusPill, HealthTable, tabeller
  src/status.js         statusmodell (ok/stale/no_key/error/none)
```

### Normaliserad postmodell (backend → frontend)

```js
metric { t:'m', area, country, source, indicator, value, unit, ts }
event  { t:'e', area, country, source, kind, severity, title, detail, start, end?, geo? }
asset  { t:'a', area, country, source, type, name, id?, geometry, attrs?, updated }
```

### API-yta (endast denna yta exponeras för frontend)

- `GET /api/summary` – KPI, statusmatris per område×land, senaste händelser, källhälsa
- `GET /api/dashboards` – områdesregistret med beräknad status
- `GET /api/dashboard/:id?country=ALL|SE|NO|DK|FI|IS` – poster + källor för ett område
- `GET /api/assets?country=&type=` – geolager (fylls i M3)
- `GET /api/health` – källhälsa

## Källor (M1)

| Källa | Område | Status |
|-------|--------|--------|
| SMHI observationsdata (metobs) | 11 Miljö/Väder (SE) | ok |
| SMHI vädervarningar (ibww) | 11 Miljö/Väder (SE) | endpoint-verifiering (503 vid test) |
| MET Norway Weather API | 11 Miljö/Väder (NO) | ok – kräver `CONTACT` i .env |
| CISA KEV | 5 Cyber (Nordiskt) | ok |
| NIST NVD CVE API 2.0 | 5 Cyber (Nordiskt) | ok |
| Svenska kraftnät Data Service (CKAN) | 1 Energi (SE) | kräver `SVK_RESOURCE_ID` |
| Fingrid Open Data | 1 Energi (FI) | kräver `FINGRID_KEY` + `FINGRID_DATASETS` |
| Trafikverket öppna API | 3 Transport (SE) | kräver `TRAFIKVERKET_KEY` |
| Digitraffic vägtrafikmeddelanden | 3 Transport (FI) | endpoint-verifiering (404 – v2-på väg) |

Källor utan nyckel visas som **"Saknar …"** i källhälsan och aktiveras automatiskt
när nyckeln läggs i `.env`.

## Nycklar och kredensials (`.env`)

```
CONTACT=…            # User-Agent-identifiering (krävs av bl.a. MET Norway)
FINGRID_KEY=…        # https://data.fingrid.fi/en/instructions
FINGRID_DATASETS=    # "datasetId:Indikator,..."
SVK_RESOURCE_ID=…    # resource_id per dataset på data.svk.se
TRAFIKVERKET_KEY=…   # konto + licens hos Trafikverket
ENTSO_E_TOKEN=…      # M2 – Transparency Platform
NVD_API_KEY=…        # valfri
```

`.env` är gitignorerad; `.env.example` dokumenterar fälten.

## Roadmap

- **M1 (klart):** ramverk – omdirigerad collector-backend, React SPA, översiktssida,
  landsskick, gemensam dashboard-mall, källhälsa.
- **M2:** övriga klass A-källor: ENTSO-E (XML, gränsflöden/avbrott/priser), Statnett,
  Energi Data Service, DMI, PeeringDB, Eurostat, NOAA SWPC (aurora), FIRST EPSS,
  MITRE ATT&CK + verifiering av SMHI-varningar och Digitraffic v2.
- **M3:** kartor – Leaflet + OSM-tiles, geolager per område (bidding zones,
  IXPs, händelser, varningspolygona), OSM Overpass-utdrag av kritiska anläggningar
  (veckovis cache, ODbL-tillstånd).
- **M4:** klass B-verifiering enligt API-katalogen, polish, dokumentation.

## Datakällor och villkor

- OSM-data: ODbL – tillståndskravl gäller (M3).
- MET Norway: unik User-Agent med kontaktuppgift; respektera cache/rate-limit.
- Fingrid: max 1 anrop/2 s, 10 000 anrop/24 h per nyckel.
- Övrigt enligt respektive källas villkor – se API-katalogen
  (`nordic_critical_infrastructure_api_catalog_utokad.xlsx`).
