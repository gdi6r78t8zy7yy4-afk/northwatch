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

Frontendtester (offline – allt nätverk mockas):

```bash
npm --prefix web test          # vitest run: 10 filer, 77 tester
npm --prefix web run test:watch
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

## Källor (33 st)

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
| Svenska kraftnät Data Service (data.svk.se, CKAN datastore) | 1 Energi (SE) | ok – nyckelfri (resurs-id är publika); fysiska gränsflöden 15 min (senaste steget → mätvärde per zonpar + "Svensk nettoexport"-KPI + kartlinjer mellan elspotzoner, DELU ritas ej), aFRR/mFRR-leveransblock, sista FCR-bidmätningen; verifierat live 2026-11-03 |
| Svenska kraftnät – historiska dataset (data.svk.se) | 1 Energi (SE) | ok – nyckelfri; fyra frusna dataset (FCR-aktiverad energi, FCR-kapacitet, FCR aggregerade volymer, dagstima-priser) med sista värdet var 6:e timme; varje post bär dataens egen tidstämpel så åldern syns i tabellen; verifierat 2026-11-03 |
| Fingrid Open Data | 1 Energi (FI) | kräver `FINGRID_KEY` + `FINGRID_DATASETS` |
| ENTSO-E Transparency Platform | 1 Energi (SE/NO/FI) | struktur verifierad; datalagret tomt 2026-11-01 (kollektorn aktiverar sig automatiskt när data finns) |
| Statnett driftsdata (gränsflöden) | 1 Energi (NO) | ok – verifierad 2026-11-01 |
| Energi Data Service | 1 Energi (DK) | ok – verifierad 2026-11-01 |
| Trafikverket öppna dataplattform (datacache v2) | 3 Transport (SE) | kräver `TRAFIKVERKET_KEY` – omskriven till datacache-API:t 2026-11-02 (M5); väg, väglag, trafikflöden, vägväder, järnväg, färjor + speedkameror på huvudvägar (kartlager), järnvägskorsningar i drift, aktiva stationmeddelanden och ersättningsbussar för inställda tåg (M7) |
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

## Trafikverket (M5)

M1/M2 använde Trafikverkets gamla API, vilket lades ned server-side (alla 400:or).
M5 (2026-11-02) omskriver kollektorn till **datacache-API:t v2**
(`https://api.trafikinfo.trafikverket.se/v2/data.json`, verifierat live 2026-11-02):

- **Autentisering:** nyckeln skickas som `<LOGIN authenticationkey='…'/>` i XML-bodyn,
  *inte* som HTTP-header. POST med `Content-Type: text/xml` + `Referer`-header.
- **Frågespråk:** `<QUERY objecttype='X' namespace='Y' schemaversion='SV' [limit=] [orderby=]>`
  med `<FILTER>` (operatorer `EQ/GT/GTE/LT/IN`, `AND`/`OR`-nestning, `$now` och
  `$dateadd(±HH:MM:SS)`-tidsuttryck) och `<INCLUDE>`-fältrader. Rå svar och
  intellisense-katalog (110 typer) finns i kollektorns headerkommentar.
- **Objekttyper (schemaversioner verifierade):** `Situation` 1.6 (~3 300 rader),
  `RoadCondition` 1.3 (~820), `TrafficFlow` 1.5 (~3 200 i fönster),
  `TrainAnnouncement` 2.0 (tidsfönsterrädd; ofiltrerat svar returnerar föråldrade
  rader), `WeatherObservation` 2.1, `TrainStation` 1.0 (1 757), `FerryAnnouncement` 1.2.
  M7 (live-verifierat 2026-11-03): `TrafficSafetyCamera` 1.0 (`Road.Infrastructure`,
  2 819 rader), `RailCrossing` 1.5 (`Road.Infrastructure`, 8 737 `"I drift"`),
  `TrainStationMessage` 1.0 (aktiva, hundra-tals) och `ReplacementTraffic` 1.0
  (namespace `JBS`, ersättningsbussar för inställda tåg).
- **Uppdateringsstrategi (API:s egen delta-markör är odokumenterad och ger 400 – vi
  hanterar vattenmärkena själva):**
  - Situation + RoadCondition: fullast vid start och var 30:e min; däremellan
    `ModifiedTime <15 min`-fönster (limit 1 000, tak detektering → tvångsfullast).
  - TrafficFlow: `MeasurementTime −20 min`, limit 5 000, `orderby MeasurementTime`;
    latest-per-SiteId hålls i minneslagret. **Fordonsflöde (fordon/h) + snittfart
    per mätstation ingår som metriskt datalag** (KPI:er + topp 25 mätare som
    kartpunkter `flowmatning`) enligt beslut 2026-11-02.
  - TrainAnnouncement: *obligatoriskt* tidsfönster −15 min…+2 h med `IN`-filter på
    följda `LocationSignature` (`TRAFIKVERKET_STATIONS`, standard
    `Cst,G,Mc,U,Lu,Ör,Vå` – Stockholm C är `Cst`, *inte* `Stl` = Ställdalen).
  - WeatherObservation: `ModifiedTime −15 min`, limit 600 (KPI:er: stationer,
    snitt vägtamperatur, is/snö-räknare).
  - TrainStation: daglig (följda stationer visas på kartan även om de är
    `Prognosticated` = ombyggda i datakatalogen, t.ex. Stockholm C).
  - **CountyNo är API:ets egen numrering, ej SCB:s länskoder** (kod 1 =
    Stockholm, 12 = Skåne, 14 = Västra Götaland, 100 = danska gränsstationer).
    Mappningen i kollektorn är empiriskt verifierad mot kända stationer och
    per-kods mätarbbox 2026-11-02.
  - FerryAnnouncement: `DepartureTime −6 h…+12 h`, limit 2 500
    (hela flödet bär `DeviationId` – inget filter behövs).
  - **M7:** `TrafficSafetyCamera` fulllistas per dygn (limit 20 000) – kameror
    på huvudvägar (E + riksvägar, ~900) blir kartpunkter `kamera` med stabil
    id `tv-camera-<Id>` + två KPI:er. OBS: `CountyNo` är *array* i denna typ
    (kod 0 = okänt, visas ej som län). `RailCrossing` fulllistas per dygn med
    `OperatingMode = 'I drift'` – KPI endast (`TrainFlow` är 0 för alla rader,
    inget flödesdatum att visa). `TrainStationMessage` per tick: bara aktiva
    (`StartDateTime < $now < EndDateTime`), `orderby ModifiedTime`, limit 1 000
    – topp 40 som händelser (de som sluter snart först) + KPI. `ReplacementTraffic`
    per tick: fönstret `PlannedDepartureTime −6 h…+24 h`, limit 500 – händelser
    med ruttlåt (LineString via stoppen, sorterade på `Sequence`);
    `finished`/`cancelled` räknas i KPI:n men blir inga händelser.
    **`$dateadd`-kvick (verifierad live):** tidsuttryck utan dagsprefix räknas
    maximalt 24 h – "24 h framöver" kräver `1.00:00:00` med dagsprefix.
- **SSE (valfritt, `TRAFIKVERKET_SSE=1`):** `sseurl='true'` ger en
  `…/data.json?ssereqid=…`-ström (`text/event-stream`, CRLF-ramad) som mergas in i
  minneslagret. Strömstarten avser en *full replay* (~12 MB) som ignorerar limit –
  default är därför polling; SSE faller tillbaka på polling efter 5 minuters tystnad.
- **Felfall:** delvis fel serverar sista goda data per typ; källan markeras `error`
  först när *inga* frågor lyckats (eller alla vid start). Enhetstester
  (`node --test "server/test/trafikverket.test.js"`) körs mot live-verifierade
  fixtures i `server/testdata/` – inget nätverk.

## Kartwidget (M6)

M6 (2026-11-03) ändrar kartpanelen på de geo-markerade dashboarden (områdena
1, 2, 3, 4, 10, 11) på tre sätt:

- **Kartstorlek S/M/L:** användaren väljer höjd (S=260, M=420, L=580 px, default
  M) i en segmenterad kontroll i kortets rubrik. Valet minns i webbläsaren
  (`localStorage`-nyckeln `nw-mapsize`; ogiltig sparad värde → M) och varje
  storleksbyte kallar `map.invalidateSize()` så Leaflet mäter om kartytan.
- **Vy bevaras vid 30 s-uppdateringen:** `MapPanel` är uppdelad i en *dataeffekt*
  (ritar lagren, körs när assets/events-referenserna byts vid polling) och en
  *vyeffekt* (körs bara vid områdes-/landsbyte, när landsgränserna laddats klart,
  eller manuellt via "Återställ vy" i kortets rubrik). 30 s-polling ritar alltså
  om datalagren men flyttar aldrig kartan. Ett land valt innan gränsdatan är
  hämtad väntar på den – ingen fallback-vy till Norden.
- **Frontendtestning:** Vitest + Testing Library + jsdom i `web/` (devDependencies
  bara, körs mot `vite.config.js` med `test`-block + `src/test/setup.js`).
  `src/test/leafletMock.js` är en deterministisk Leaflet-mock som loggar
  `setView`/`fitBounds`/`invalidateSize`, lagerkapning och –skapande, så testerna
  kan verifiera *när* kartan får nya måtten/vyer. Täckning: MapPanel (vy vs data,
  S/M/L, alla lager), DashboardPage (30 s-polling, källstatus), SummaryPage
  (matris, KPI, navigering), App, TopBar, HealthTable, RecordsTables, StatusPill
  samt `status.js` och `api.js`.

## Nycklar och kredensials (`.env`)

```
CONTACT=…            # User-Agent-identifiering (krävs av bl.a. MET Norway; används
                     #   även som Digitraffic-User-headern för FI:s trafik-API:er)
FINGRID_KEY=…        # https://data.fingrid.fi/en/instructions
FINGRID_DATASETS=    # "datasetId:Indikator,..."
SVK_API_BASE_URL=…   # standard https://data.svk.se – CKAN datastore API, helt öppet
                     #   (ingen API-nyckel enligt SVK:s API Guide). Resurs-id:n (UUID)
                     #   är publika datasetidentiteter på portalen.
SVK_PHYSICAL_FLOWS_RESOURCE_ID=…    # aktiva (svk.js, 15 min): gränsflöden
SVK_AFRR_CAPACITY_RESOURCE_ID=…     # aktiva (svk.js, 15 min): aFRR-leveransblock
SVK_MFRR_CAPACITY_RESOURCE_ID=…     # aktiva (svk.js, 15 min): mFRR-leveransblock
SVK_FCR_BID_VOLUMES_RESOURCE_ID=…   # aktiva (svk.js, 15 min): FCR-erbjudandevolymer
SVK_FCR_ACTIVATED_ENERGY_RESOURCE_ID=…   # historiska (svk-hist.js, 6 h), frusna:
SVK_FCR_CAPACITY_RESOURCE_ID=…           #   FCR-aktiverad energi, FCR-kapacitet,
SVK_FCR_AGGREGATED_VOLUMES_RESOURCE_ID=… #   FCR aggregerade volymer,
SVK_DAY_AHEAD_PRICES_RESOURCE_ID=…       #   dagstima-priser
TRAFIKVERKET_KEY=…   # M5 – datacache v2; autentisering sker i XML-bodyn (<LOGIN>), ej header
TRAFIKVERKET_STATIONS=  # M5 – valfria följda järnvägsstationer (LocationSignature);
                        #   standard Cst,G,Mc,U,Lu,Ör,Vå (OBS: 'Stl' = Ställdalen)
TRAFIKVERKET_SSE=…     # M5 – 1 = SSE-ström (valfritt; default polling)
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
- **M5 (klart 2026-11-02):** Trafikverket omskrivet till datacache-API:t v2 – LOGIN-
  autentisering i XML-bodyn, per-typ vattenmärkespolling (ModifiedTime-fönster,
  fullast som tak), fordonsflöde (TrafficFlow) som metriskt datalag med topp-25-
  kartpunkter, tåganmälningar för valda stationer (LocationSignature), vägväder-KPI:er,
  påverkade färjeavgångar, valfri SSE-ström; enhetstester mot live-fixtures
  (server/testdata/), felfelhantering per typ. Se "Trafikverket (M5)".
- **M6 (klart 2026-11-03):** kartwidget – användarvald storlek S/M/L (persisteras i
  webbläsaren), kartan återställer inte längre vyn vid 30 s-uppdateringen
  (dataeffekt/vyeffekt separerade, "Återställ vy"-knapp), full frontendtesttäckning
  (Vitest + Testing Library, deterministisk Leaflet-mock, 77 tester).
  Se "Kartwidget (M6)".
- **SvK-omskrivning (klart 2026-11-03):** Svenska kraftnät-kollektorn byggd om mot
  data.svk.se:s öppna CKAN datastore-API (`datastore_search`, ingen API-nyckel –
  resurs-id:n är publika och ligger ifyllda i `.env.example`). Två kollektorer:
  `svk` (15 min) hämtar fysiska gränsflöden (senaste 15-min-steget → mätvärde per
  zonpar, "Svensk nettoexport"-KPI och kartlinjer mellan elspotzonernas
  zonskilda – DELU saknar skilda och ritas ej), aFRR-/mFRR-leveransblock för den
  igångvarande timmen samt sista FCR-bidmätningen; `svk-hist` (6 h) visar de fyra
  historiska dataseten som SVK frusit per 2026-11-03 ("Discontinued" /
  "Currently not updating") med sista värdet respektive och datasetets egna
  tidstämpel. Enhetstester mot live-fixtures (server/test/svk.test.js).
- **M7 (klart 2026-11-04):** Trafikverket datacache – fyra nya objekttyper
  (live-verifierade 2026-11-03 med kollektorns egna frågor): speedkameror på
  huvudvägar (E + riksvägar) som nytt kartlager `kamera` i MapPanel (egen
  färg/legend, ~900 punkter) + KPI:er; järnvägskorsningar i drift (KPI);
  aktiva stationmeddelanden som händelser (topp 40, som sluter snart först) +
  KPI; ersättningsbussar för inställda tåg som händelser med ruttlåt
  (LineString via stoppen, sorterade på `Sequence`) + KPI. Enhetstester mot
  live-fixtures (server/testdata/), MapPanel-test för `kamera`-lagret.

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
- Trafikverket datacache (M5): licenserad API-nyckel skickas i XML-bodyn
  (`<LOGIN authenticationkey='…'/>`), `Referer`-header sätts per anrop; rate-limit
  `100;w=1` (100 anrop/60 s) respekteras av pollningsintervallen (~7 frågor/minut).
- Övrigt enligt respektive källas villkor – se API-katalogen
  (`nordic_critical_infrastructure_api_catalog_utokad.xlsx`).
