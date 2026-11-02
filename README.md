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
server/                 backend – ett enda JS-beroende: fast-xml-parser (ENTSO-E XML)
  app.js                HTTP: /api/* + statisk servering av web/dist
  areas.js              de 12 dashboardområdena (namn, scope, luckor, geo-flagga)
  lib/env.js            läser .env
  lib/http.js           fetch-hjälp (User-Agent med kontakt, timeout)
  lib/store.js          minneslager: normaliserade poster + källhälsa
  lib/scheduler.js      pollar varje källa med sitt intervall (staggerad uppstart)
  lib/jsonstat.js       json-stat 2.0-parser (SCB v2 + SSB v2, M4)
  lib/geolayers.js      statiska kartlager, zonmittpunkter, OSM/Overpass-utdrag (veckocache)
  assets/*.geojson      landsgränser (Natural Earth) + energilager (HVDC, zonankar)
  cache/                OSM-veckocache på disk (gitignorerad)
  collectors/*.js       en modul per källa → normaliserade poster
web/                    Vite + React SPA (svenskt gränssnitt)
  src/App.jsx           routing (HashRouter), globalt landsskick, 30 s-refresh
  src/pages/            SummaryPage (statusmatris), DashboardPage (gemensam mall)
  src/components/       TopBar, StatusPill, HealthTable, tabeller, MapPanel (Leaflet)
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
- `GET /api/assets?area=&country=` – geolager som poster (kraftanläggningar, datacenter,
  flygplatser, vattenverk, IX-positioner, zonflöden, AIS-fartyg); `NORDIC` ingår alltid i country-filtret
- `GET /api/geo/static` – statiska kartlager (landsgränser + energilager), ändras sällan
- `GET /api/health` – källhälsa

## Källor (M1–M4, 32 st)

| Källa | Område | Status |
|-------|--------|--------|
| SMHI observationsdata (metobs) | 11 Miljö/Väder (SE) | ok |
| SMHI vädervarningar (ibww) | 11 Miljö/Väder (SE) | endpoint-verifiering (503 – värdnamnet ej reserbart från testnätet) |
| MET Norway Weather API | 11 Miljö/Väder (NO) | ok – kräver `CONTACT` i .env |
| DMI climate data (station 06180) | 11 Miljö/Väder (DK) | ok – verifierad 2026-11-01 |
| CISA KEV | 5 Cyber (Nordiskt) | ok |
| NIST NVD CVE API 2.0 | 5 Cyber (Nordiskt) | ok |
| FIRST EPSS | 5 Cyber (Nordiskt) | ok – nyckelfri, daglig |
| MITRE ATT&CK (Enterprise) | 5 Cyber (Nordiskt) | ok – veckovis, ETag-cache |
| Svenska kraftnät Data Service (CKAN) | 1 Energi (SE) | kräver `SVK_RESOURCE_ID` |
| Fingrid Open Data | 1 Energi (FI) | kräver `FINGRID_KEY` + `FINGRID_DATASETS` |
| ENTSO-E Transparency Platform | 1 Energi (SE/NO/FI) | struktur verifierad; datalagret tomt 2026-11-01 (kollektorn aktiverar sig automatiskt när data finns) |
| Statnett driftsdata (gränsflöden) | 1 Energi (NO) | ok – verifierad 2026-11-01 |
| Energi Data Service | 1 Energi (DK) | ok – verifierad 2026-11-01 |
| Trafikverket öppna API | 3 Transport (SE) | kräver `TRAFIKVERKET_KEY` – gammal datamodell nedlagd server-side (se kollektorn) |
| Digitraffic vägtrafikmeddelanden | 3 Transport (FI) | ok – v1/messages verifierad 2026-11-01 |
| PeeringDB (IX) | 2 Digital infrastruktur (Nordiskt) | ok – verifierad 2026-11-01 |
| Eurostat (BNP, SDMX 2.1) | 7 Industri (Nordiskt) | ok – verifierad 2026-11-01 |
| NOAA SWPC (Kp, F10.7) | 10 GNSS/Rymd (Nordiskt) | ok – verifierad 2026-11-01 |
| OSM/Overpass: kraft & nät | 1 Energi (Nordiskt) | veckovis – kraftverk (`power=plant`) + kraftstationer ≥100 kV; verifierad 2026-11-02 |
| OSM/Overpass: datacenter | 2 Digital (Nordiskt) | veckovis – `building=data_center(-centre)`; verifierad 2026-11-02 |
| OSM/Overpass: flygplatser | 3 Transport (Nordiskt) | veckovis – `aeroway=airport/aerodrome` (utan militära); verifierad 2026-11-02 |
| OSM/Overpass: vattenverk | 4 Vatten (Nordiskt) | veckovis – `man_made=water_works`, `sewage=works`; verifierad 2026-11-02 |
| Energinet Electricity Market Service | 1 Energi (DK) | ok – Mfrr-efterfrågan DK1/DK2 (15-min, teckenriktade MW); verifierad 2026-11-02 |
| Vedur (Vedur) | 11 Miljö/Väder (IS) | ok – jordbävningar (GeoJSON), vulkaner, synopobservationer, CAP-varningar; verifierat 2026-11-02 |
| SCB Statistikdatabasen v2 | 7 Industri (SE) | ok – utrikeshandel TAB4516 + företag (FDB) TAB5166 per tillverkningsavsnitt; verifierat 2026-11-02 |
| SSB pxwebapi v2 | 7 Industri (NO) | ok – utrikeshandel i varor, tabell 08864 (månad, mNOK); verifierat 2026-11-02 |
| StatFin (Tilastotoimisto) | 7 Industri (FI) | ok – industriomsättningens index 14mt (kvartal, NACE C); verifierat 2026-11-02 |
| Digitraffic (Rata, järnväg) | 3 Transport (FI) | ok – resenärinformation (förseningar) + tågbestånd/fördröjning (ej position); verifierat 2026-11-02 |
| Digitraffic (Meri, AIS) | 3 Transport (FI) | ok – AIS-positioner kring 6 huvudhamnar (r 40 km), kartposter för fartyg i rörelse; verifierat 2026-11-02 |
| Riksbank (API-katalog) | 9 Finans (SE) | ok – öppen API-yta (5 gratis API:er); datagatewayns operationer ej publikt upptäckbara (17 testanrop, se kollektorn) |
| NVE HydAPI | 4 Vatten (NO) | kräver `NVE_API_KEY` (gratis) – vattenstånd per station; 401 utan nyckel, verifierat 2026-11-02 |
| CDS/ERA5 (Copernicus) | 11 Miljö/Väder (Nordiskt) | kräver `CDS_TOKEN` + `CDS_EMAIL` (gratis) – 2m-temperatur över Norden (yesterday 00 UTC); multipart-POST verifierat mot API:s kontrakt 2026-11-02 |

OSM-källorna köas internt (den publika instansen 429:ar vid samtidighet) och återförs med
backoff. Vid fortgående nätverksmisse återanvänds den senaste diskcachen och källan
står i `error` i hälsan (kartan fungerar utan anläggningspunkterna).

Källor utan nyckel visas som **"Saknar …"** i källhälsan och aktiveras automatiskt
när nyckeln läggs i `.env`.

## Klass B-verifiering (M4)

Katalogens sheet "Dashboard-mappning" har **21 rader med klass B** ("API sannolikt finns –
endpoint/schema ska väljas och testas"). M4 (2026-11-02) löser alla rader: **12 rader tagits
upp** (varav 3 redan stod på plats i M1/M2 – NVD, EPSS, EDS; väghalvan av Digitraffic-raden
var M1 – övriga genom de 10 nya M4-kollektonerna) och **9 rader dokumenteras som ej
tagits upp** med skäl. Allt verifierat med testanrop 2026-11-02; rå svar och
schema-noteringar finns i respektive kollektors headerkommentar.

| Katalograd | Land · Område | Källa (enl. katalogen) | Bedömning M4 |
|-----------|---------------|------------------------|--------------|
| 26 | DK · 1 Energi | Energi Data Service | Tagits upp (M2) – `energidataservice`: produktion/förbrukning/nettoflöde/CO2 per 15 min |
| 27 | DK · 1 Energi | Energinet Public Data API | Tagits upp (M4) – `energinet`: Mfrr-efterfrågan DK1/DK2 |
| 9 | SE · 7 Industri | SCB / Kommerskollegium | Tagits upp: SCB (M4) – `scb`: TAB4516 (handel) + TAB5166 (företag per tillverkningsavsnitt). Kommerskollegium ej: portal utan öppet API |
| 11 | SE · 9 Finans | Riksbanken / Finansinspektionen | Tagits upp: Riksbanken (M4) – `riksbank`: öppen API-yta (5 gratis API:er). Begränsning: datagatewayns operationer ej publikt upptäckbara (17 testanrop → 404, se kollektorn). Finansinspektionen ej: tillsynsrapporter, inget öppet API |
| 7 | SE · 4 Vatten | SMHI / SGU / Vattenmyndigheterna (hydrologi) | Ej tagits upp – ingen fastställd publik endpoint i katalogen (NOT_YET_VERIFIED, portal-URL); SMHI:s meteo-öppendata samlas redan (M1, område 11) |
| 15 | NO · 3 Transport | Statens vegvesen (DATEX II) | Ej tagits upp – DATEX-II-endpointen svarar 401 (ingen dokumenterad öppen åtkomst) |
| 19 | NO · 4 Vatten | NVE (hydrologi) | Tagits upp (M4) – `nve` HydAPI: vattenstånd per station; kräver gratis `NVE_API_KEY` |
| 21 | NO · 7 Industri | Statistics Norway / SSB | Tagits upp (M4) – `ssb`: tabell 08864 (utrikeshandel i varor, månad) |
| 25 | NO · 12 Förvaltning | DSB / data.norge.no | Ej tagits upp – data.norge.no är enbart datakatalog (inga endpoints); DSB är operatör utan öppen data-API |
| 34 | DK · 7 Industri | Statistics Denmark | Ej tagits upp – `api.stats.dk` TLS-mellanhänt från testnätet (ej API-brist); kan återverifieras från annat nät |
| 40 | FI · 3 Transport | Fintraffic/Digitraffic (väg, järnväg, sjö) | Tagits upp – väg (M1) `digitraffic`; M4: `digitraffic-rail` (Rata: förseningar + tågbestånd) och `digitraffic-marine` (Meri: AIS, 6 hamncirklar, fartygslager på kartan) |
| 41 | FI · 11 Miljö | FMI (WFS/WMS) | Ej tagits upp – öppet WFS är bara ofiltrerade sparade frågor (43 MB+- svar / grib2-referenser; inget rent JS-dekoderingsbibliotek för grib2 i projektets beroendeprofil) |
| 45 | FI · 6 Hälsa | THL | Ej tagits upp – portal/varningsflöde utan stabilt dokumenterat API |
| 46 | FI · 7 Industri | Statistics Finland | Tagits upp (M4) – `statfinland`: industriomsättningens index 14mt (kvartal, NACE C) |
| 52 | IS · 3 Transport | Vegagerðin | Ej tagits upp – ingen publik REST-API (portal) |
| 53 | IS · 11 Miljö | Icelandic Met Office (Vedur) | Tagits upp (M4) – `vedur`: jordbävningar, vulkaner/askmoln, synopobservationer, CAP-varningar |
| 68 | NORDIC · 5 Cyber | NIST NVD | Tagits upp (M1) – `nvd` |
| 77 | NORDIC · 5 Cyber | FIRST EPSS | Tagits upp (M2) – `epss` |
| 71 | NORDIC · 3 Transport | EU National Access Points | Ej tagits upp – portaler per medlemsland utan enhetlig API-yta |
| 72 | NORDIC · 11 Miljö | Copernicus EMS | Ej tagits upp – portal (katasofprodukter via klientansökan; skild process från CDS) |
| 76 | NORDIC · 11 Miljö | Copernicus Climate Data Store | Tagits upp (M4) – `cds` ERA5 2m-temperatur över Norden; kräver gratis `CDS_TOKEN` + `CDS_EMAIL` |

## Nycklar och kredensials (`.env`)

```
CONTACT=…            # User-Agent-identifiering (krävs av bl.a. MET Norway; används
                     #   även som Digitraffic-User-headern för FI:s trafik-API:er)
FINGRID_KEY=…        # https://data.fingrid.fi/en/instructions
FINGRID_DATASETS=    # "datasetId:Indikator,..."
SVK_RESOURCE_ID=…    # resource_id per dataset på data.svk.se
TRAFIKVERKET_KEY=…   # konto + licens hos Trafikverket
ENTSO_E_TOKEN=…      # M2 – Transparency Platform
NVD_API_KEY=…        # valfri
NVE_API_KEY=…        # M4 – NVE HydAPI, gratis: https://hydapi.nve.no (header X-API-Key)
NVE_STATIONS=…       # M4 – valfri fast stationslista "6.10.0,..." (annars hämtas
                     #   NVE_STATION_LIMIT första aktiva stationerna, standard 5)
CDS_TOKEN=…          # M4 – Copernicus CDS, gratis: https://cds.climate.copernicus.eu/profile
CDS_EMAIL=…          # M4 – kontots e-post (CDS kräver token + e-post per anrop)
```

`.env` är gitignorerad; `.env.example` dokumenterar fälten.

## Roadmap

- **M1 (klart):** ramverk – omdirigerad collector-backend, React SPA, översiktssida,
  landsskick, gemensam dashboard-mall, källhälsa.
- **M2 (klart 2026-11-01):** övriga klass A-källor (18 totalt): ENTSO-E (nya REST-API:t,
  IEC XML – struktur verifierad, datalagret tomt vid tidpunkten), Statnett, Energi Data
  Service, DMI (observations), PeeringDB, Eurostat (SDMX 2.1), NOAA SWPC, FIRST EPSS,
  MITRE ATT&CK + fix av Digitraffic (v1/messages). Trafikverkets gamla API är
  nedlagt server-side; SMHI-varningar kvarstår som endpoint-verifiering.
- **M3 (klart 2026-11-02):** kartor – Leaflet + OSM-tiles (OSM attribution), interaktiv
  karta på de geo-markerade områdena (1, 2, 3, 4, 10, 11). Geolager per område:
  landsgränser (Natural Earth 50m), HVDC-länkar + schematiska zonmittpunkter (statiskt
  lager, explicit markerat som approximativt), internetutbyten (PeeringDB),
  gränsflöden per spotzon (Statnett), vägtrafikevemeddelanden med geografi (Digitraffic)
  samt veckovisa OSM/Overpass-utdrag av kritiska anläggningar – kraftverk/kraftstationer,
  datacenter, flygplatser, vattenverk (diskcache, ODbL-tillstånd, sparsamt attributval).
- **M4 (klart 2026-11-02):** klass B-verifiering enligt API-katalogen – alla 21 klass B-rader
  lösta: 12 tagits upp (10 nya kollektorer: Energinet, Vedur, SCB, SSB, StatFin,
  Digitraffic Rata + Meri, Riksbanken, NVE, CDS/ERA5; NVD/EPSS/EDS stod redan på plats),
  9 ej – dokumenterade med skäl (se "Klass B-verifiering (M4)"). Gemensam json-stat 2.0-parser
  (`lib/jsonstat.js`, SCB v2 + SSB v2), AIS-fartygslager på kartan (`fartyg` i MapPanel),
  luckotexter uppdaterade per område (areas.js), nyckeldokumentation (NVE, CDS).

## Datakällor och villkor

- OSM-data: ODbL – tillståndskravl gäller (M3).
- MET Norway: unik User-Agent med kontaktuppgift; respektera cache/rate-limit.
- Fingrid: max 1 anrop/2 s, 10 000 anrop/24 h per nyckel.
- Digitraffic (väg/järnväg/sjö, M4): villkoren kräver identifiering via `Digitraffic-User`
  -headern (byggs av `CONTACT` i `.env`) och max 1 anrop/s – kollektorerna håller 1,1 s
  mellan anrop (sjö: 6 anrop/cykel, järnväg: 2) och pollar var 5:e/10:e minut.
- NVE HydAPI (M4): gratis API-nyckel i header `X-API-Key`.
- Copernicus CDS (M4): gratis personal access token; varje anrop kräver token **och**
  kontots e-post. Frågor köas på serversidan och kan ta flera minuter → 6 h-intervall,
  10 min anropstid.
- `api.stats.dk` (M4): TLS-mellanhänt (certifikatfel) från testnätet – anmärkt, ej
  API-brist; källan är därför ej tagits upp (se Klass B-tabellen).
- Övrigt enligt respektive källas villkor – se API-katalogen
  (`nordic_critical_infrastructure_api_catalog_utokad.xlsx`).
