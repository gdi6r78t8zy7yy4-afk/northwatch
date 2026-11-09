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
npm --prefix web test          # vitest run: 24 filer, 226 tester
npm --prefix web run test:watch
```

Backendtester (offline – live-verifierade fixtures i `server/testdata/`):

```bash
node --test "server/test/*.test.js"   # 166 tester
```

## Persistens och driftsättning

Backendens normaliserade collector-poster och källhälsa använder ett
utbytbart persistenslager. Lokalt är `STORE_DRIVER=local` standard och källsnapshots
skrivs atomiskt till `server/data/store.json` (eller `NORTHWATCH_STORE_FILE`). Energi-mätvärden
appendas separat till `server/data/energy-history.jsonl` (eller `NORTHWATCH_ENERGY_HISTORY_FILE`),
med deduplicering per källa/indikator/mättid. Firestore använder underkollektionen
`northwatch_energy_history/{UTC-dag}/measurements/{measurementId}`; samlingsnamnet kan
ändras med `FIRESTORE_ENERGY_HISTORY_COLLECTION`.
För Cloud Run väljer du `STORE_DRIVER=firestore`; Firestore-adaptern sparar
källmetadata och chunkade snapshots av poster. Vid uppstart återställs senaste
snapshot innan schemaläggaren startar. Källor som tidigare var `ok` markeras
`stale` tills en ny lyckad hämtning sker.

**Viktigt för containerdrift:** filsnapshoten är avsedd för lokal utveckling eller
en VM med beständig disk. Cloud Run-instansers lokala filsystem är inte en
beständig databas och kan försvinna när instanser byts ut eller skalar till noll.
För Google AI Studio/Cloud Run ska lagret därför kopplas till Cloud Firestore
(eller Cloud SQL for PostgreSQL) via nätverksanslutning. Se avsnittet
"Google AI Studio – beständig datalagring" nedan. SMHI-prognosens separata
filcache har samma begränsning i Cloud Run.

### Google AI Studio – beständig datalagring

I AI Studio Build mode: välj **Settings → Integrations → Firebase Firestore & Auth**
(eller be AI Studio-agenten att lägga till Firestore). Välj rätt Google Cloud/Firebase-
projekt och databasregion redan från början – regionen kan inte ändras i efterhand.
Använd Firestore som backendens persistenslager, inte webbläsarens localStorage
och inte Cloud Run-containerns lokala filer.

För Northwatch bör servern lagra normaliserade poster per källa och återläsa dem
vid uppstart. Northwatchs Firestore-adapter använder Firestore REST API från backend och
Cloud Run Application Default Credentials via metadata-servern. Ge Cloud Run-
servicens service account rollen `roles/datastore.user` och aktivera
Firestore API. Sätt `STORE_DRIVER=firestore` och `GOOGLE_CLOUD_PROJECT` i
Cloud Run-miljön. Ingen service-account-nyckel ska checkas in eller exponeras
i frontend. För lokal emulatorutveckling kan `FIRESTORE_EMULATOR_HOST` anges. Lägg användarens sparade dashboard-layoutar och personliga inställningar
i separata användarägda dokument, skyddade med Firebase Authentication och
Firestore Security Rules. Serverns REST-anrop autentiseras och auktoriseras via
Cloud IAM och Cloud Runs service account.

Adaptern lagrar för närvarande hela källans normaliserade poster i chunkade
snapshotdokument (max cirka 450 kB per chunk) och återställer dem till Northwatchs
befintliga in-memory read model. Det bevarar nuvarande API-kontrakt men innebär
att filtrering fortfarande görs i backendminnet; det är inte ännu ett
direktfrågebart event store. Användarprofiler och användarlayoutar bör lagras
separat med Firebase Authentication och lämpliga Security Rules.
Välj Firestore för normaliserade händelser, mätvärden, tillgångar och användarlayoutar.
Om datamängderna växer till stora historiska tidsserier eller avancerad SQL-analys,
överväg Cloud SQL for PostgreSQL i stället. Lägg till TTL/retention för historiska
poster och index för `source`, `area`, `country`, `ts` och `start`.

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
(`#/d/1` … `#/d/12`) med gemensam mall: karta (där tillämpbart), väderprognos (område 11),
indikatorer, händelser, källhälsa och kända luckor. Landsskick väljs i toppraden
(sparas i webbläsaren).

## Arkitektur

```
server/                 backend – ett enda JS-beroende: fast-xml-parser (ENTSO-E XML)
  app.js                HTTP: /api/* + statisk servering av web/dist
  areas.js              de 12 dashboardområdena (namn, scope, luckor, geo-flagga)
  lib/env.js            läser .env
  lib/http.js           fetch-hjälp (User-Agent med kontakt, timeout)
  lib/store.js          normaliserade poster + källhälsa, snapshots + energihistorik
  lib/energy.js         normaliserad energiöversikt
  lib/energy-insights.js historikserier + deterministiska energiobservationer
  lib/scheduler.js      pollar varje källa med sitt intervall (staggerad uppstart)
  lib/jsonstat.js       json-stat 2.0-parser (SCB v2 + SSB v2, M4; Eurostats
                        platta objektform, M10)
  lib/forecast.js       SMHI snow1g-prognos: cykelretention (12) + /api/forecast (M8)
  lib/cyber.js          cyberdatslager: NVD (veckosubfönster, TTL 15 min) + KEV-katalogen
                        + OSV.dev-watchlist + /api/cyber/* (M9, område 5)
  lib/industry.js       industristatusanalys: tre komponenter (produktion/handel/
                        kapacitet) → 0–100-poäng per land + NORDIC, ren funktion
                        utan store-koppling (M10, område 7)
  lib/forvaltning.js    förvaltningsanalys: tre komponenter (aktivitet/kontinuitet/
                        observerbarhet) → 0–100 per land + NORDIC (M11, område 12)
  lib/gnss.js           GNSS-indexanalys: fyra komponenter (tillgänglighet/stabilitet/
                        varningstäthet/täckning) → 0–100 per land + NORDIC (M12, område 10)
  lib/gnss-correlation.js rymdväder↔NAGU-anomalier och kedjor + narrativtext (M12)
  lib/llm.js            valfri OpenAI-kompatibel sammanfattare – null utan LLM_BASE_URL,
                        fel sprider sig aldrig till routen (M12)
  lib/geolayers.js      statiska kartlager, zonmittpunkter, OSM/Overpass-utdrag (veckocache)
  assets/*.geojson      landsgränser (Natural Earth) + energilager (HVDC, zonankar)
  cache/                OSM-veckocache + SMHI-prognoscyklar på disk (gitignorerad)
  collectors/*.js       en modul per källa → normaliserade poster
  collectors/smhi-forecast.js  prognoscyklar: 11 stadspunkter + härledda väderhändelser (M8)
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
- `GET /api/energy/overview?country=ALL|SE|NO|DK|FI|IS` – senaste energimätningar,
  gränsflöden och källstatus
- `GET /api/energy/history?range=6h|24h|7d|30d&country=&indicator=` – historiska
  mätserier grupperade per land/källa/indikator/enhet; historiken börjar byggas från
  driftsättning av den här versionen och backfylls inte med syntetiska värden
- `GET /api/energy/analysis?country=` – deterministiska observationer när mätvärden
  kan jämföras med matchande tidsstämpel/enhet; varje observation visar evidens och caveat
- `GET /api/forecast/meta` – aktuell prognoscykel: tider, katalogpunkter, rutnätsparametrar
  (M8, område 11)
- `GET /api/forecast/point?point=<namn>` eller `?lat=&lon=` – full tidsserie för en punkt
  (404 utanför domänen, 503 innan första cykeln)
- `GET /api/forecast/grid?parameter=&time=&downsample=` – rutnätsvärden för kartan
- `GET /api/forecast/grid-coords?downsample=` – koordinatindex för rutnätet
- `GET /api/cyber/nvd?window=7|14|30&severity=&q=&sort=newest|score&limit=` – publicerade
  CVE ur det delade 30-dagarsfönstret (M9, område 5); `dbTotal` (databastotalen) finns bara
  när `NVD_API_KEY` är satt, `capped=true` när NVD:s pagineringsspärr klipper fönstret
- `GET /api/cyber/kev?q=&ransomware=&sort=added|due&limit=` – CISA KEV-katalogen,
  nyast först, med 90-dagars-/ransomware-/frist-KPI:er och 12-månaders-histogram
- `GET /api/cyber/osv?ecosystem=` – OSV.dev-rapporter mot det övervakade paketutbudet
  (`OSV_WATCH_PACKAGES`), fönstret 180 d, per paket status/totalt/nya 90 d/recenta rapporter
- `GET /api/cyber/prioritized` – de senaste 15 KEV-tillägg med CVSS från NVD
  (30-dagarscachet först, sedan enskild `?cveId=`-slagning; icke-CVE-poster markeras
  ej upplösta)
- `GET /api/cyber/overview` – sammanfattning av de tre cacherna (triggar aldrig
  källhämtning)
- `GET /api/industry/status?country=NORDIC|SE|NO|DK|FI|IS` – beräknad industristatus:
  poäng 0–100, tre komponenter (produktion/handel/kapacitet med tydbasis), drivfaktorer
  och per-land-rader vid NORDIC; deterministisk derivation ur `store.js`-records
  (triggar aldrig källhämtning) (M10, område 7)
- `GET /api/industry/data?country=ALL|SE|NO|DK|FI|IS` – underliggande records per
  källa + källstatus för per-källa-panelerna; landsvy inkluderar även NORDIC-records
  (t.ex. RMIS-importberoendelarm som gäller hela blocket)

## Källor (48 st)

| Källa | Område | Status |
|-------|--------|--------|
| SMHI observationsdata (metobs) | 11 Miljö/Väder (SE) | ok |
| SMHI vädervarningar (ibww) | 11 Miljö/Väder (SE) | endpoint-verifiering (503 – värdnamnet ej reserbart från testnätet) |
| SMHI väderprognos (snow1g) | 11 Miljö/Väder (Nordiskt) | ok – nyckelfri; timvisa cyklar (~15 min efter timslaget), de 12 senaste speglade på disk; 11 katalogstäder (5 SE, 3 NO, 1 FI, 1 DK, 1 IS utanför domänen) + valfri plats (klick) + rutnät i ~50 km-avstånd (ds20); härledda väderhändelser; verifierat live 2026-11-05 |
| MET Norway Weather API | 11 Miljö/Väder (NO) | ok – kräver `CONTACT` i .env |
| DMI climate data (station 06180) | 11 Miljö/Väder (DK) | ok – verifierad 2026-11-01 |
| CISA KEV | 5 Cyber (Nordiskt) | ok – hela katalogen (~1 800 posteringar, JSON-bakåten hos katalogsidan); prioriteringsunderlag, ej incidentdetektion; M9-widget `/api/cyber/kev` |
| NIST NVD CVE API 2.0 | 5 Cyber (Nordiskt) | ok – delat 30-dagarspubliceringsfönster hämtat som 7-dagars-subfönster (nyast först; ~13 500 rader, pagineringsspärrar vissa veckor → `capped`); `NVD_API_KEY` höjer rate-limiten och lägger till databastotalen; M9-widget `/api/cyber/nvd`; verifierat live 2026-11-06 |
| OSV.dev (Open Source Vulnerabilities) | 5 Cyber (Nordiskt) | ok – nyckelfri; `POST /v1/query` per paket mot ett kurerat utbud på 26 paket relevant för kritisk infrastruktur (`OSV_WATCH_PACKAGES` "Ecosystem:Paket;…" för att överskriva, Maven delas på första kolon); 180-dagsfönster, nya 90 d som KPI; M9-widget `/api/cyber/osv`; verifierat live 2026-11-06 |
| FIRST EPSS | 5 Cyber (Nordiskt) | ok – nyckelfri, daglig |
| MITRE ATT&CK (Enterprise) | 5 Cyber (Nordiskt) | ok – veckovis, ETag-cache |
| Svenska kraftnät Data Service (data.svk.se, CKAN datastore) | 1 Energi (SE) | ok – nyckelfri (resurs-id är publika); fysiska gränsflöden 15 min (senaste steget → mätvärde per zonpar + "Svensk nettoexport"-KPI + kartlinjer mellan elspotzoner, DELU ritas ej), aFRR/mFRR-leveransblock, sista FCR-bidmätningen; verifierat live 2026-11-03 |
| Svenska kraftnät – historiska dataset (data.svk.se) | 1 Energi (SE) | ok – nyckelfri; fyra frusna dataset (FCR-aktiverad energi, FCR-kapacitet, FCR aggregerade volymer, dagstima-priser) med sista värdet var 6:e timme; varje post bär dataens egen tidstämpel så åldern syns i tabellen; verifierat 2026-11-03 |
| Fingrid Open Data | 1 Energi (FI) | kräver `FINGRID_KEY`; standarduppsättning: total produktion/förbrukning + vind, vattenkraft, kärnkraft och industriell kraftvärme (MW, 3 min; dataset 192/193/181/191/188/202); `FINGRID_DATASETS` kan ersätta urvalet; produktionsslagen är delindikatorer, inte en fullständig mix |
| Elprisetjustnu.se (API v1) | 1 Energi (SE) | nyckelfritt – day-ahead-priser per 15 min (SE1–SE4), SEK/kWh, dagens + morgondagens publicerade intervall; exkl. moms/skatter/påslag; synlig källhänvisning i dashboarden |
| ENTSO-E Transparency Platform | 1 Energi (SE/NO/FI) | struktur verifierad; datalagret tomt 2026-11-01 (kollektorn aktiverar sig automatiskt när data finns) |
| Statnett driftsdata | 1 Energi (NO/Nordiskt) | nyckelfritt – fysiska gränsflöden per zon + norsk nationell produktion/förbrukning (MW, timvärden); 1–2 % felmarginal; förbrukning beräknas från produktion och nettoimport/export |
| Energi Data Service | 1 Energi (DK) | ok – produktion/förbrukning/nettoflöde/CO₂ per 15 min; kompletteras av Energinet PowerSystemRightNow (1 min, SCADA-baserat, approximativt) |
| Landsnet Amper (Iceland) | 1 Energi (IS) | publikt JSON-endpoint som används av Electricity Maps – senaste produktionsmixen geotermisk/vattenkraft/olja (MW); endast aktuell snapshot, ingen historik eller förbrukningsserie; naiva tidsstämplar tolkas som Islandstid (UTC) |
| Trafikverket öppna dataplattform (datacache v2) | 3 Transport (SE) | kräver `TRAFIKVERKET_KEY` – omskriven till datacache-API:t 2026-11-02 (M5); väg, väglag, trafikflöden, vägväder, järnväg, färjor + speedkameror på huvudvägar (kartlager), järnvägskorsningar i drift, aktiva stationmeddelanden och ersättningsbussar för inställda tåg (M7) |
| Digitraffic vägtrafikmeddelanden | 3 Transport (FI) | ok – v1/messages verifierad 2026-11-01 |
| PeeringDB (IX) | 2 Digital infrastruktur (Nordiskt) | ok – verifierad 2026-11-01 |
| Eurostat (BNP, SDMX 2.1) | 7 Industri (Nordiskt) | ok – verifierad 2026-11-01 |
| NOAA SWPC (Kp, F10.7) | 10 GNSS/Rymd (Nordiskt) | ok – verifierad 2026-11-01; ingår i GNSS-indexet som stabilitet + geomagnetiska stormhändelser (M12) |
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
| Eurostat SDMX 2.1 (industri- och råvaruflöden) | 7 Industri (Nordiskt) | ok – nyckelfri; sju flöden (se "Industri (M10, område 7)"), contentconstraint-drivena keyqueries; CC- och keyquery-kontraktet verifierat live 2026-11-07, data-API:t var systembrett nede samma dag → datafixtures är CC-formverifierade med synthetiska värden (canary: `NAMA_10_GDP/A.CP_MEUR.B1GQ.SE+NO+DK+FI+IS?format=JSON`) |
| OECD SDMX (STI stålkapacitet) | 7 Industri (Nordiskt) | ok – nyckelfri; råstålkapacitet per land, årlig (Mt); CSV med kod+etikett-kolumnpar (högerankrade fält – "China (People's Republic of)" bär ett OTCITERAT kommatecken); DNK/ISL utan kapacitet släpps; verifierat live 2026-11-07 |
| JRC RMIS / EU CRMs (kritiska råvaror) | 7 Industri (Nordiskt) | ok – nyckelfri; materialkatalogen (36 råvaror), EU-importberoende (händelser vid ≥50 %, high vid ≥80 %), nordisk leverans/utvinning till EU, nordiska reservor, MCI per land, CRMA-ambitioner; verifierat live 2026-11-07 |
| UN Comtrade (varuhandel) | 7 Industri (Nordiskt) | ok – preview-läge nyckelfri (hårt rate-limited → 4 s paus, `COMTRADE_PREVIEW_DELAY_MS`); `COMTRADE_API_KEY` (gratis, comtradeplus.un.org, ~500 anrop/dag) ger fullt data-API. Båda querystring-baserade (API-dokumentation: comtradeplus.un.org/ApiDocs); keyed svaret väljs på den unika raden `motCode=0 && partner2Code=0` (totalraden, klientsida); export/import per land, senaste genomförda år, USD, partner=världen; bägge lägen verifierade live 2026-11-08 |
| Statistics Iceland (Hagstofan, pxwebapi v1) | 7 Industri (IS) | ok – nyckelfri; varuhandel UTA06002 (exports/imports fob, cif, balans, mISK, månad); 429 vid <8 s → 9 s paus (`STATICE_DELAY_MS`); ingen aktuell industriproduktionstabell (IDN01000 avslutad 2018) → produktion via Eurostat; verifierat live 2026-11-07 |
| Sveriges riksdag (data.riksdagen.se) | 12 Förvaltning (SE) | ok – nyckelfri (ange alltid Sveriges riksdag som källa); fyra veckovisa flöden: kammarkalendern (JSON, ~85 händelser), `votering-<kammarår>.json.zip` + `anforande-<kammarår>.json.zip` (rullande kammarårsfönster), `person.json.zip` (historiskt register); zipsens UTF-8-filnamn läses av egen nollberoendeläsare (`lib/zip.js`); subflödesfel → "hämtfel"-record (null); verifierat live 2026-11-08 |
| DigDir Felles datakatalog (search.api.fellesdatakatalog.digdir.no) | 12 Förvaltning (NO) | ok – nyckelfri, CC0; söks-API:t (officiellt internt/instabilt, 10 rpm → 6 s takt, `FDK_DELAY_MS`): `page.totalElements` = sant antal, filter `lastXDaysModified`/`lastXDays`, `aggregations.openData` → öppna andel (98,6 %); veckohämtning, 5 frågor; verifierat live 2026-11-08 |
| Retsinformation (api.retsinformation.dk) | 12 Förvaltning (DK) | ok – nyckelfri; `GET /v1/Documents?date=YYYY-MM-DD` (max 10 dagar bakåt, klippad 03:00), sju explicita anrop med 1,2 s takt (`RTI_DELAY_MS`); veckodagar ~100–150 dokument/dag, helger normalt tomma = data (value 0), ej fel; instabilt API (non-JSON/tom kropp på slumpmässiga datum) → 3 försök per dag med progressiv paus, kvarvarande fel → "hämtfel"-record + delvis totalt; daglig hämtning; verifierat live 2026-11-08/09 |
| Finlex avoindata (opendata.finlex.fi) | 12 Förvaltning (FI) | ok – nyckelfri (User-Agent krävs); AKN-lista med ETTRABASERAD paginering (page=0 → 400) utan totalt antal → räkna genom paginering (`FINLEX_MAX_PAGES`, "(estimat)" vid tak); samma lag per språkversion (`fin@`/`swe@`) → avdubbling på lagenr; 429 (fönster efter ~180–200 snabba anrop) → progressiv backoff, kumulativt 5/15/30 s, bevarat delvis totalt "(estimat)"; veckohämtning (löpande år YTD + föregående år); rättspraxis/HE/AS saknas som API; verifierat live 2026-11-08/09 |
| IPU Parline (api.data.ipu.org) | 12 Förvaltning (Nordiskt) | ok – nyckelfri, CC BY-NC-SA 4.0 (källtillkännagivande gäller); bar query-parametrar ignoreras → `filter=<fält>:<op>:<värde>`; attribut är tidsserier → sist icke-nulla värde; val hämtas alla (stigande ordning) → senaste valet; IS saknar party-record (`meta.total` saknas); veckohämtning, 20 anrop med 1 s takt (`IPU_DELAY_MS`); verifierat live 2026-11-08 |
| data.europa.eu Data Portal (hub-sök) | 12 Förvaltning (Nordiskt) | ok – nyckelfri; landfilter via `facets={"country":[…]}` (JSON-string) + `filters=dataset`, `countOnly=true` → billiga räkningar, `minDate`+`dateType=modified` = uppdaterade ≤30 d; 3 anrop/land (total, ≤30 d, 3 nyaste som händelser); IS via EFTA-kataloger i portalen; månadshämtning; verifierat live 2026-11-08 |
| EUR-Lex / Cellar SPARQL (publications.europa.eu) | 12 Förvaltning (Nordiskt) | ok – nyckelfri, fri återanvändning med källa; publikt SPARQL-slutpunkt (`FILTER REGEX` på CELEX – Virtuoso saknar glob); CELEX `32YYYY` = EU-rättsliga handlingar från år YYYY (L direktiv / R förordningar / D beslut); fyra räkningar (YTD + per typ); månadshämtning; verifierat live 2026-11-08 |
| CelesTrak GP (celestrak.org) | 10 GNSS/Rymd (Nordiskt) | ok – nyckelfri; `FORMAT=json` krävs för räkning, fyra grupper (galileo/glo-ops/sbas/gps-ops); epoker utan tidszon är UTC → zongas vid ålderberäkning; >72 h → stale-varning (SBAS uppdateras glesare); 1,2 s takt (`CELESTRAK_DELAY_MS`), ett retry per grupp; verifierat live 2026-11-09 |
| Galileo Security Gateway (gsc-europa.eu) | 10 GNSS/Rymd (Nordiskt) | ok – nyckelfri; RSS-feeden ger NAGU-händelser (start/slut/severitet), konstellationssidan (HTML-tabell) ger USABLE/PHM/NAGU per GSAT-satellit; 15-minutershämtning; verifierat live 2026-11-09 |
| M3G GNSS Stations API (gnss-metadata.eu, EPOS) | 10 GNSS/Rymd (SE/NO/DK/FI/IS) | ok – nyckelfri, CC BY 4.0 (citera doi:10.24414/ROB-GNSS-M3G); sitelog-svaret är GeoJSON med max 20 features/anrop och `limit`/`page` ignoreras → fast bbox-rutnät per land + en nivå kvadrantsdelning; mättad ruta → antalet rapporteras "(minst)"; stationerna blir kartposter; ~40 anrop/körning (daglig) med 0,25 s takt (`M3G_DELAY_MS`); verifierat live 2026-11-09 |
| NASA APOD (science.nasa.gov wp-json) | 10 GNSS/Rymd (Nordiskt) | ok – nyckelfri; publiceringstakten är information enbart och ingår inte i GNSS-indexet; verifierat live 2026-11-09 |
| data.norge.no / Felles datakatalog (GNSS-sökning) | 10 GNSS/Rymd (NO) | ok – nyckelfri, CC0; samma FDK-söks-API som M11:s `fdk` (`POST /search/datasets`) med frågorna "gnss" och "posisjonering"; delad ~10 rpm-begränsning → 6,5 s takt (`DATANORGE_DELAY_MS`); veckohämtning; verifierat live 2026-11-09 |

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
| 25 | NO · 12 Förvaltning | DSB / data.norge.no | Tagits upp (M11) – data.norge.no = DigDir:s Felles datakatalog (`fdk`: söks-API, CC0). DSB ej: operatör utan öppen data-API. Området täcks även av riksdagen (SE), Retsinformation (DK), Finlex (FI) samt IPU + data.europa.eu + EUR-Lex (5 länder); se "Förvaltning (M11, område 12)" |
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
  S/M/L, alla lager, M8: prognosrutnäts-overlay + klick), DashboardPage (30 s-polling, källstatus, M8: väderprognos i område 11), SummaryPage
  (matris, KPI, navigering), App, TopBar, HealthTable, RecordsTables, StatusPill
  samt `status.js` och `api.js`. M8 lade till `symbolCodes.test.js` (SMHIs
  vädersymbol-/nederbördstyp-koder + kompassriktning), `wxGrid.test.js`
  (rutnät → pixelmatris, ren och canvasfri), `ForecastChart.test.jsx`
  (SVG-graf: gap-split, tröskellinjer, pointer-urval) och
  `WeatherForecastPanel.test.jsx` (punktval, skrubbar, felstater).

## Väderprognos (M8, område 11)

SMHIs öppna prognos-API (snow1g, 2,5 km-grundrutnät) är nyckelfritt –
kontaktuppgiften i `CONTACT` räcker. Cyklar släpps ~varje timme (ca 15 min
efter timslaget, UTC) med ~81 timsteg (max 10 dygn). Kollektorn
(`collectors/smhi-forecast.js`) pollar `createdtime.json` var 5:e minut; vid
cykelbyte hämtas `times.json` + tidsserier (15 parametrar) för de 11
katalogstäderna (5 SE, 3 NO, 1 FI, 1 DK + Reykjavik IS, som ligger utanför
domänen → `outsideDomain` och markeras i stadsvälgaren).

- **Retention:** de 12 senaste cyklarna speglas på disk
  (`server/cache/smhi-forecast/<cykel>.json`) – tidsserier och
  griddatavärden (`smhi-grid-<param>-<time>-ds<N>-<cykel>.json`) överlever
  omstart; vid tommt minne laddas senaste diskcykeln in av API:et
  (`loadLatestFromDisk`). Fritvalda platser (klick) cachas i minnet bara,
  giltiga under aktuell cykel.
- **Ny API-yta** (se "API-yta"): `/api/forecast/meta` (cykel, tider,
  punkter, rutnätsparametrar), `/api/forecast/point?point=<namn>` eller
  `?lat=&lon=` (404 utanför domänen, 503 innan första cykeln),
  `/api/forecast/grid?parameter=&time=&downsample=` och
  `/api/forecast/grid-coords?downsample=`. Griddatavärden frågas med
  kompakt tidsformat (`YYYYMMDDThhmmssZ`) + gzip – ISO-tid ger 404
  (verifierat live 2026-11-05).
- **Härledda väderhändelser:** tröskelbrott i kommande dygn → händelser
  med `kind: väderprognos` ("beräknad utifrån prognos"): byar ≥ 22,5 m/s
  (röd) / ≥ 17 m/s (orange), temperatur ≤ −15 °C (orange), åskrisk
  ≥ 60 % (gul), frusn nederbörd ≥ 50 % (gul), nederbörd (max per intervall)
  ≥ 20 mm (gul). Ibww-varningstjänsten (SMHI vädervarningar) har varit 503
  sedan 2026-11-01 – dessa händelser kompenserar delvis luckan i område 11.
- **Frontend (bara område 11):** handgjorda SVG-grafer – sex serier
  (temperatur, vind/byar, nederbörd, åska/isrisk, tryck/fuktighet) med
  gemensam tidsskrov och tröskelmarkörer; kartans prognosrutnät
  (Leaflet imageOverlay, 4 parametrar, nedjustering 1–20, default 20 →
  48×54-raster i ~50 km-avstånd) ritas under datalagren. Klick på kartan
  sätter en "Anpassad plats" (2 decimaler) som punktprognos; legendens
  tider följer standardformatet `yyyy-mm-dd hh:mm UTC`.
- **API:s egenvilja (verifierat live 2026-11-05):** `times.json` har
  nyckeln `time`; nederbördsparametrar är växande intervallsummor
  (1→3→6→12 h) – `intervalParametersStartTime` markerar intervallstarten;
  `missingValue` = 9999 (och `precipitation_frozen_part` = −9 vid ingen
  nederbörd); grundrutnätet är roterat ~20° så radordning kan inte
  antas – frontenden rasteriserar varje punkt uttryckligen mot bgränsen
  (`src/lib/wxGrid.js`, ren och canvasfri i jsdom).
- **Tester:** `server/test/smhi-forecast.test.js` (18 tester, offline
  mot fixtures ur en live-cykel 2026-11-05) + M8-webbtest – se
  "Kartwidget (M6)" → Frontendtestning.

## Industri (M10, område 7)

Per-källa-widgeter + beräknad industristatus per land. Landsvyn (SE/NO/DK/FI/IS)
visar per-källa-detalj; den nordiska vyn (NORDIC/ALL) visar sammanfattning – poäng,
komponenter, per-land-tabell – plus luckkort. Tio siffergrupper: Eurostat, OECD,
JRC RMIS, UN Comtrade, Statistics Iceland och de nationella statistikbyråerna
SCB/SSB/StatFin (M4). Analysen är en ren funktion (`lib/industry.js`) som
deriverar poängen ur `store.js`-records vid varan `/api/industry/*`-slagning –
ingen källhämtning, ingen cache (records ligger redan i store:t).

**Statusmodell (0–100 per land, viktat snitt av tre komponenter;
`saknad komponent` renormaliseras över de övriga vikterna):**

| Komponent | Vikt | Indata (senaste värde per källa) | Formel (clampad 0–100) |
|-----------|------|----------------------------------|------------------------|
| Produktion | 0.5 | 12-månadersförändring % (Eurostat EI_ISIR_M, Statice) + produktionsindex (Eurostat EI_ISIN_M, SCB/SSB/StatFin) | `50 + 5·yoy` respektive `50 + 2·(index − 100)` per källa; snitt |
| Handel | 0.3 | Handelsbalans per källa (nationella byråer balans/import, EFTA-handel) och UN Comtrade (export − import) | `50 + 100·balans/import` per källa (Comtrade: `50 + 100·(X−M)/M`); snitt; `fob-fob`-balansen föredras |
| Kapacitet | 0.2 | Råstålkapacitet Mt (OECD) + antal material landet levererar till EU (RMIS) | `clamp(20 + 6·steelMt, 0, 70) + min(30, 2·material)` |

Label: **≥65 Expansiv, 45–64.9 Stabilt, <45 Kontraktion, inget data Okänt.**
NORDIC = snitt av de fem länderna (komponenterna var för sig, poängen över de
länder som har en); `drivers` visar per land `XX: poäng (label)` och
`countries` bär de fullständiga per-land-radiena till tabellen.

**Kollektorer och flöden (alla nyckelfria utom UN Comtrade:s valfria nyckel):**

- **Eurostat SDMX 2.1** (`eurostat-industry.js`) – sju flöden. Varje körning
  hämtar contentconstraint (XML) per flöde, bygger keyquery ur de tillåtna
  värdena och hämtar JSON-stat (`lastNObservations`; Eurostats platta
  objektform `{obsIndex: värde}` hanteras i `lib/jsonstat.js`). Flöden:
  `EI_ISIN_M` (index 2021=100, månad), `EI_ISIR_M` (12-månadersförändring %,
  RT12), `TEIBS070` (lagerförändring tillverkning, DK/FI/SE), `GLOE_CRM_PS`
  (företag som importerar kritiska råvaror, 2021–2023), `EXT_LT_INTERCC`
  (EFTAs handel mot EU-27/utanför/världen, IS/NO), `EXT_LT_MAINRAWM`
  (EU-27:s råvaruimport per partner), `NAMQ_10_A10` (mervärdetillökning, NACE C).
  `EI_IS_M_VTG` distribueras inte (ERR_NOT_FOUND_2) och `EXT_LT_MAINEU` utesluts
  (ersatt av INTERCC+MAINRAWM). Felisolering per flöde: misslyckas alla throwas,
  misslyckas några → "Dataflöde {id}: hämtfel"-metrik + övriga records levereras.
- **OECD** (`oecd.js`) – råstålkapacitet, årlig (Mt), via SDMX STI
  `DSD_STEEL_CAPACITY@DF_CRUDE_STEEL` (CSV, kod+etikett-kolumnpar;
  `UNIT_MULT=6` → Mt). Vänsterankrade fält förskjuts av "China (People's
  Republic of)":s OTCITERADE kommatecken → högerankrade fält (OBS_VALUE −8,
  TIME_PERIOD −10, OBS_STATUS −4, UNIT_MULT −2). DNK/ISL har tomt OBS_VALUE
  (ingen kapacitet) → släpps. SE/NO/FI + DE/JP/CN som internationell kontext.
- **JRC RMIS / EU CRMs** (`rmis.js`) – kommissionens offentliga råvaruportal
  (materials/overview/exploration/processing/crma). Records: materialkatalogen
  (36 råvaror) som metrik, topp-5 EU-import/produktion, MCI per nordiskt land,
  **importberoende ≥50 % som händelser** (high vid ≥80 %, medel 50–79 %),
  nordisk leverans/utvinning till EU (senaste år per land+material) och
  nordiska reservor, CRMA-ambitioner. `env`-endpolet sanitykallas men ger inga
  records (semantik obekräftad).
- **UN Comtrade** (`comtrade.js`) – två lägen. API:t dokumenteras på
  **comtradeplus.un.org/ApiDocs** (Swagger ur OpenAPI-specarna
  `comtradeapi.un.org/files/v1/app/apim/{public,comtrade}.json`). BÅDA
  produkterna är querystring-baserade: sökvägen bär bara typ/freq/klassificering
  (`/C/A/HS`), resterande koder – inkl. `period` som PLINT 4-siffrigt år
  (inte `A2025`) – går som query parameters; den äldre vägsbaserade formen
  ger 404. **Utans nyckel:** `public/v1/preview` (1 rad per anrop), gratis men
  hårt rate-limited (429) → 4 s paus mellan anropen (`COMTRADE_PREVIEW_DELAY_MS`,
  standard 4000). **Med `COMTRADE_API_KEY`:** `data/v1/get` med header
  `Ocp-Apim-Subscription-Key`; gratisnyckel från **comtradeplus.un.org**
  (registrera med e-post, verifiera via e-postlänk, skapa subscription i
  "My API portal", kopiera nyckeln; ~500 anrop/dag). Data: export/import per
  land (reporter 752 SE / 578 NO / 208 DK / 246 FI / 352 IS, partner 0 =
  världen, cmd TOTAL, USD, senaste genomförda år → år oberoende av när
  pollingen sker). Keyed-svaret bryter ner raderna på `motCode`
  (transportmedel; 0 = summa, 9900 = ej deklarerat) × `partner2Code` (0 = allt)
  med `isAggregate:true` på ALLA rader → kollektören väljer den unika raden
  `motCode=0 && partner2Code=0` klientsida (samma selektor som preview:s
  enskilda rad; `motCode` som query-param hänger, väljs ej server-side).
  Keyed-API:t är långsamt (1–6 s/anrop) och ger sporadiska 500:or → 2 s takt
  mellan anropen (`COMTRADE_KEYED_DELAY_MS`, standard 2000) + begränsad retry
  med exponentiell backoff på 429/5xx/nätverk/timeout (`COMTRADE_RETRY_MAX`,
  standard 2 → 3 försök; samma mönster som NVD i M9). Per-anrops-felisolering.
  `count=0` (HTTP 200 men rapportören har inga data) är **inte** ett hämtfel →
  record "Comtrade {land} {X/M}: ej rapporterat ({år})" med value null (panelen
  visar landet som en "–"-rad med året). Norge (578) har inga dataset i Comtrade
  alls – verifierat 2026-11-08 via `public/v1/getDA` (SE 1992–2025, DK 1989–2025,
  FI 1988–2025, IS 1988–2025, NO 0 rader) → NO visas alltid "ej rapporterat".
- **Statistics Iceland** (`statice.js`) – pxwebapi v1, `Efnahagur/UTA06002.px`
  (varuhandel, mISK: exports fob, imports fob/cif, balans fob-fob/cif-fob,
  månad). 429 vid anrop tättare än ~8 s → 9 s paus mellan struktur- och
  datafrågan (`STATICE_DELAY_MS`, standard 9000). Parsernot: data-radernas
  `values`-array innehåller **endast de valda c-kolumnernas** värden (index 0 i
  urvalet), inte alla kolumners. Ingen aktuell industriproduktionstabell
  (IDN01000 avslutad 2018) → Islands produktion täcks via Eurostat.
- **SCB / SSB / StatFin** (M4, oförändrade) – nationell utrikeshandel och
  omsättningsindex (mrdSEK / mNOK / index) som ytterligare produktions- och
  handelskällor per land.

**API:** `/api/industry/status?country=` (beräknad poäng + komponenter +
drivfaktorer; NORDIC ger dessutom `countries`) och
`/api/industry/data?country=ALL|<land>` (records per källa + källstatus för
panelerna; landsvy inkluderar NORDIC-records). Båda synkrona derivationer ur
`store.js` – svarstiden är obefintlig.

**Frontend:** `IndustryView` (två 120 s-feeds: status + data, dependens på
valda land) distribuerar records + `meta {loading, error, fetchedAt, onRetry}`
till presentationella paneler (`IndustryPanels.jsx`) – en panel per källa
(Eurostat, OECD stål, Comtrade, RMIS, nationella byråer) + statuspanelen.
Datafelet visar fel i alla per-källa-panelerna (records blir null, inte []),
retry hämtar datat igen. Nordic-vyn visar luckkort (IEA har inget publikt API,
Statistics Denmark ej upptaget – TLS-mellanhänt, Comtrade preview-nyckel).

**Live-status 2026-11-07/08:** OECD, RMIS, Statice verifierade live
2026-11-07. **Comtrade verifierat live i BÅDA lägen 2026-11-08** mot nuvarande
API:t (querystring-form, se ovan): preview ger 1 totalrad per anrop, keyed ger
`motCode`×`partner2Code`-nedbrytning – kollektörns totalradselector
(`motCode=0 && partner2Code=0`) matchar i båda (SE X 2025 = 208 483 056 356 USD,
SE M 2025 = 202 212 034 647 USD; fixtures i `testdata/industry/` är
form- och värdeverifierade mot live). **NO (578) svarar count=0 för alla år** –
Norge har inga Comtrade-dataset alls (getDA) → "ej rapporterat"-records (se ovan). Eurostats **data-API var systembrett nede**
2026-11-07 (contentconstraint-kontraktet fungerade) och var fortfarande nede
2026-11-08 → `server/testdata/industry/` har CC-formverifierade datafixtures med
**syntetiska värden**; kollektorn pickar upp det riktiga datat automatiskt vid
nästa körning. Canary för liveverifiering av de sju datafrågorna:
`NAMA_10_GDP/A.CP_MEUR.B1GQ.SE+NO+DK+FI+IS?format=JSON` → 200.

**Tester:** `server/test/industry.test.js` (50 tester: kollektorns recordantal
mot fixtures med URL-rutad fetch-mock, `parseCC`/`buildKey`, OECD `parseRow`,
RMIS `latestByCountryMaterial` + `tradeQuery`, Comtrade `pickTotal`/`queryFor`
+ keyed fetch (URL/header) + `fetchTotal`-retry + count=0 "ej rapporterat",
`classify`, komponentformlerna, `labelOf`, status-/data-regressionvärden per
land + NORDIC) + webbtest
(`industryPanels.test.jsx` – alla panels ok/fel/loading-lägen + IndustryView:s
koppling; `DashboardPage.test.jsx` – område 7 grenar, övriga områden rör aldrig
`/api/industry/*`).

## Förvaltning (M11, område 12)

Per-källa-widgeter + beräknat Förvaltningsindex per land. Landsvyn (SE/NO/DK/FI/IS)
visar landets nationella källa + gemensamma paneler (IS saknar nationell källa →
luckkort); den nordiska vyn (NORDIC/ALL) visar sammanfattning – poäng, komponenter,
per-land-tabell – samtliga sju källor och luckkort. Sju källor: Sveriges riksdag
(SE), DigDir:s Felles datakatalog (NO), Retsinformation (DK), Finlex (FI) och tre
gemensamma baser – IPU Parline (parlamenten som 5-länders bas), data.europa.eu
(öppna dataset per land) och EUR-Lex/Cellar (EU:s rättsliga produktion). Analysen
är en ren funktion (`lib/forvaltning.js`) som deriverar poängen ur `store.js`-records
vid varan `/api/forvaltning/*`-slagning – ingen källhämtning, ingen cache.

**Statusmodell (0–100 per land, viktat snitt av tre komponenter;
`saknad källa` → saknad komponent → vikterna renormaliseras över de övriga,
M10-modellen):**

| Komponent | Vikt | Indata (per källa, 0–1-vara) | Formel (clampad 0–100) |
|-----------|------|------------------------------|------------------------|
| Aktivitet | 0.4 | Per-källa aktivitetsmätare (begränsade/log-skalor) | snitt över tillgängliga källor ×100 |
| Kontinuitet | 0.3 | Institutionerna pågår – aktuella mandat/sessioner, pågående flöden | snitt ×100, därefter × **datafreshness**: 1 inom källans takt → linjärt 0 vid 3× takt (årstidsstämpel som "2026" räknas frisk) |
| Observerbarhet | 0.3 | Öppenhet – andel öppna dataset, sammansättning, publicerad grunddata | snitt ×100 |

**Per-källa mätare (varje mätare 0–1; komponenten är snittet över källorna som
levererar den):**

| Källa (takt) | Aktivitet | Kontinuitet | Observerbarhet |
|--------------|-----------|-------------|----------------|
| riksdagen (SE, vecko) | `log10(1 + events + 0.25·omröstn. + 0.15·anföranden)/2` | 1 vid ≥1 kommande kalenderhändelse, annars 0.2 | `0.6·(ledamöter/350) + 0.4·(kvinnor/ledamöter)` |
| fdk (NO, vecko) | `nyregistrerade ≤365 d / 1000` | metadataändring ≤30 d > 0 → 1 / ≤365 d > 0 → 0.5 / annars 0.1 | andel öppna dataset |
| retsinformation (DK, daglig) | `lagändringar 7 d / 500` | > 0 → 1, annars 0.4 | `dokumenttyper / 8` |
| finlex (FI, vecko) | `nya lagar YTD / 300` | nya > 0 → 1, annars 0 | `(versioner YTD + nya + ändrade föreg. år) / 3000` |
| ipu (5 länder, vecko) | `lagar per år / 800` | senaste val ≤7 år → 1 / ≤10 år → 0.5 / annars 0.2 | `0.5·kvinnor/ledamöter + 0.3·partier/15 + 0.2·anställda/700` |
| dataportal (5 länder, månad) | `uppdaterade ≤30 d / 1000` | > 0 → 1, annars 0.2 | `√(total/25 000)` (mängderna skiljer ~40× mellan länderna → sqrt-skala) |
| cellar (NORDIC, månad) | `EU-texter YTD / 3000` | > 0 → 1, annars 0 | som aktivitet |

**Label: ≥75 Hög trygghet, 55–74,9 Stabilt, 35–54,9 Uppmärksamhet, <35 Svag,
inget data Okänt.** NORDIC = snitt av de fem länderna (komponenterna var för sig,
poängen över de länder som har en); `drivers` visar per land `XX: poäng (label)`
och `countries` bär de fullständiga per-land-radiena till tabellen.

**Kollektorer och flöden (alla nyckelfria):**

- **Sveriges riksdag** (`riksdagen.js`) – ingen API-nyckel; ange alltid Sveriges
  riksdag som källa. Fyra veckovisa flöden: kammarkalendern
  `GET /kalender/?org=kamm&utformat=json` (URL:en ska sluta med snedstreck, annars
  404; ~85 händelser: ~4 veckor bakåt + kommande sammanträden),
  `votering-<kammarår>.json.zip` (ett JSON per omröstning med röster per
  inställning) och `anforande-<kammarår>.json.zip` (rullande kammarårsfönster) samt
  `person.json.zip` (historiskt register). Kammaråret (t.ex. 202627) härleds ur
  datuman: sep–dec → `YYYY(YY+1)`, jan–aug → `(YYYY-1)YYYY`; 404 → prov på
  föregående period. Zip-posterna bär UTF-8-filnamn (macOS `unzip` fastnar) →
  egen nollberoendeläsare `lib/zip.js` (store + deflate, CRC32). Subflödesfel →
  nollade "hämtfel"-records (comtrade-mönstret); källan är ok så snart minst ett
  av fyra flöden levererar.
- **DigDir Felles datakatalog** (`fdk.js`) – Norges öppna metadatakatalog, CC0.
  Söks-API:t är officiellt internt/instabilt (OpenAPI-spec:
  `search.api.fellesdatakatalog.digdir.no/v3/api-docs`) med 10 rpm (burst 20) →
  6 s takt mellan anropen (`FDK_DELAY_MS`, nollas i tester).
  `POST /search/datasets` (body `{query:"", filters, pagination:{size:1,page:0}}`);
  `page.totalElements` är det sanna antalet (hits = en sida); verifierade filter
  `lastXDaysModified`/`lastXDays` (Integer); `aggregations.openData` → andelen
  öppna dataset. Fem frågor per körning: totalt, öppna antal + andel, ändrad
  metadata ≤365 d, nyregistrerade ≤365 d, ändringar ≤30 d.
- **Retsinformation** (`retsinformation.js`) – dansk lagändringar (Folketingets
  lovsamling), ingen nyckel. `GET /v1/Documents?date=YYYY-MM-DD` (specifikt datum,
  max 10 dagar bakåt; standardfönstret "senaste 24 h" undviks – det kan överlappa
  igårs datedata); sju explicita `?date=`-anrop med 1,2 s takt (`RTI_DELAY_MS`),
  dagens data klippad 03:00. Svaret är en bar JSON-array. API:et är instabilt
  (non-JSON/tom kropp på slumpmässiga datum, verifierat live 2026-11-09) →
  tre försök per dag med progressiv paus (1,2/2,4 s); även då fel →
  "hämtfel"-record och delvis totalt (källan ej failed). Veckodagar ~100–150
  dokument/dag; helger är normalt tomma – ett tomt fönster är data, inte ett fel
  (value 0). Per dag + per dokumenttyp (BEK, LBK, SØF m.fl.) + de senaste 210
  lagändringarna som händelser.
- **Finlex** (`finlex.js`) – finländsk lagsättning via AKN-URI:er; nyckelfri men
  User-Agent krävs. `GET …/akn/fi/act/statute/list?startYear&endYear&limit=10&page=N`:
  page är ETTRABASERAD (page=0 → 400), svaret en bar array
  `[{akn_uri, status:"NEW"|"MODIFIED"}]` utan totalt antal → räkna genom paginering
  (`FINLEX_MAX_PAGES` 350 → "(estimat)" vid tak). Samma lag förekommer en gång per
  språkversion (`/fin@`, `/swe@`) → avdubbling på lagenr. 429 (rate limit; fönstret efter
  ~180–200 snabba anrop, verifierat 2026-11-09) → progressiv backoff,
  kumulativt 5/15/30 s (fönstret öppnas efter ~30 s); misslyckas en sida
  ändå bevaras de räknade som "(estimat)" (failed bara vid noll data).
  Veckohämtning: löpande år (YTD) + föregående år (hela året). Rättspraxis
  (HFD/KHO/HS) och HE/AS saknas som API → luckkort + renormalisering i analysen.
- **IPU Parline** (`ipu.js`) – parlamenten som 5-länders grundbaslinje; ingen
  nyckel, källtillkännagivande gäller (data: CC BY-NC-SA 4.0). Viktigt: bar
  query-parametrar IGNORERAS → `filter=<fält>:<op>:<värde>` (`id:eq:SE`,
  `id:eq:SE-LC01`, `political_party_country:eq:SE`); enveloppen `{data, meta,
  links}`; attribut är tidsserier `[{value, date_from, …}]` → sist icke-nulla
  värde; party-records är platta; IS saknar `meta.total` → inget partier-record
  (panelen visar "–"); valen returneras stigande → hämta alla (≤25/land) och ta
  senaste. 20 anrop per körning, 1 s takt (`IPU_DELAY_MS`).
- **data.europa.eu Data Portal** (`dataportal.js`) – hub-sök, ingen auth.
  `q=`-syntax och `sort=` ändrar INTE resultatantalet; landfiltrering görs med
  `facets={"country":["se"]}` (JSON som string) + `filters=dataset`;
  `countOnly=true` → `{result:{index,count}}` (billiga räkningar); `minDate` +
  `dateType=modified` = uppdaterade ≤30 dagar. Tre anrop per land: total, ≤30 d,
  tre nyaste (som händelser med lokaliserad titel). IS via EFTA-kataloger i
  portalen. Månadshämtning, 1,5 s takt (`DATAPORTAL_DELAY_MS`).
- **EUR-Lex / Cellar** (`cellar.js`) – unionsrättsliga texter via publik
  SPARQL-slutpunkt: `POST publications.europa.eu/webapi/rdf/sparql` (body
  `query=`, CDM-prefix). Virtuoso saknar glob-operator → `FILTER REGEX(?celex,
  "^32026")`. CELEX `32YYYY` = EU-rättsliga handlingar från år YYYY (L direktiv,
  R förordningar, D beslut); fyra räkningar: YTD-totalt + per typ. EU:s
  upphovsrätt – fri återanvändning med källtillkännagivande. Månadshämtning.

Uteslutna från den utökade källlistan: OECD (inget område-12-signal), norden.org
(403, ingen öppen feed) och EUR-Lex-webservice:t (kräver registrering) – Cellars
SPARQL täcker EU-sidan.

**API:** `/api/forvaltning/status?country=` (beräknat Förvaltningsindex +
komponenter + drivfaktorer; NORDIC ger dessutom `countries`) och
`/api/forvaltning/data?country=ALL|<land>` (records per källa + källstatus för
panelerna; landsvy inkluderar NORDIC-records). Båda synkrona derivationer ur
`store.js` – svarstiden är obefintlig.

**Frontend:** `ForvaltningView` (två 120 s-feeds: status + data, dependens på
valda land) distribuerar records + `meta {loading, error, fetchedAt, onRetry}`
till presentationella paneler (`ForvaltningPanels.jsx`) – en panel per källa
(riksdagen, FDK, Retsinformation, Finlex, IPU, data.europa.eu, EUR-Lex/Cellar) +
statuspanelen. Landsvyn visar landets nationella källa + gemensamma paneler; IS
har ingen nationell källa (Althinget har inget öppet API) → luckkort
(`IslandGapCard`), parlamentet täcks ändå via IPU. Nordic-vyn visar
sammanfattning + samtliga sju källor + kända luckor (krisinformation &
varningssystem, Finlex rättspraxis/HE/AS, IPU partier för IS, OECD/Norden).
Datafelet visar fel i alla sju recordbaserade panelerna (records blir null, inte
[]), retry hämtar datat igen.

**Live-status 2026-11-08/09:** samtliga sju källor verifierade live.
Riksdagen: 4 omröstningar (rullande fönster) / 451 anföranden / 3 527 personer i
registret (316 tjänstgörande), ~85 kalenderhändelser. FDK: 9 227 dataset, varav
9 101 öppna (98,6 %), 8 768 med uppdaterad metadata ≤365 d, 799 nyregistrerade
≤365 d. Retsinformation: 2026-11-06 = 125 dokument. Finlex 2026 (löpande):
882 nya lagar, 121 ändrade, 1 938 versioner YTD. data.europa.eu: se 25 085
(1 161 ≤30 d), no 9 559, dk 3 707, fi 2 959, is 611. Cellar 2026 (YTD): 2 736
EU-rättsliga texter (L 412 / R 1 288 / D 847). Fixtures i
`server/testdata/forvaltning/` är formverifierade mot live med syntetiska värden.

**Tester:** `server/test/forvaltning.test.js` (38 tester: renfunktioner –
kammarår/iCal/zip/unzip/`openDataShare`/`summarizeDay`/`lastNDays`/`statuteNumber`/
`lastVal` m.fl., kollektorer mot 11 fixtures med URL-rutad fetch-mock +
Finlex-429-regression (backoff→retry, ihållande 429→estimat, noll data→failed),
RTI-503-regression (retry→fullt totalt, ihållande→hämtfel + delvis totalt),
inminnes- ZIP-skribent som matchar `lib/zip.js`, Förvaltningsindex-regressionvärden
per land + NORDIC (SE 82,0 / NO 73,0 / DK 62,1 / FI 57,8 / IS 56,3 / NORDIC 66,2)
+ `forvaltningData`) + webbtest (`ForvaltningPanels.test.jsx`, 28 tester – alla
panelers ok/fel/loading-lägen + `ForvaltningView`:s koppling till
`/api/forvaltning/*`, IS-luckkortet och datafel som propagerar till de sju
panelerna).

## GNSS/Rymd (M12, område 10)

Per-källa-widgeter + beräknat GNSS-index per land. Landsvyn (SE/NO/DK/FI/IS) visar de
globala källorna + nationella register (data.norge.no för NO); den nordiska vyn
(NORDIC/ALL) visar sammanfattning – poäng, komponenter, per-land-tabell – samtliga sex
källor och luckkort. Sex källor: NOAA SWPC (geomagnetisk aktivitet), CelesTrak GP
(konstellationernas elementset), GSC Europa (Galileo-tillgänglighet + NAGU-adviseringar),
M3G GNSS Stations API/EPOS (stationsmetadata för fem länder), data.norge.no/Felles
datakatalog (NO registerantal) och NASA APOD (publiceringstakt, information enbart).
Analysen är en ren funktion (`lib/gnss.js`) som deriverar poängen ur `store.js`-records
vid varje `/api/gnss/*`-slagning – ingen källhämtning, ingen cache.

**Statusmodell (0–100 per land, viktat snitt av fyra komponenter; saknad komponent →
vikterna renormaliseras över de övriga, M10/M11-modellen):**

| Komponent | Vikt | Indata | Formel (clampad 0–100) |
|-----------|------|--------|------------------------|
| Tillgänglighet | 0.35 | Galileo USABLE-andel (GSC, global) × aktiv stationsandel (M3G, land) | produkt av tillgängliga delar ×100 |
| Stabilitet | 0.25 | Kp-index (NOAA SWPC, global) | ≤4 → 100, 5 → 70, 6 → 40, 7 → 20, ≥8 → 0 |
| Varningstäthet | 0.20 | NAGU-händelser startade inom 30 dagar (GSC-feeden, global) | `1 − log1p(n)/log(9)` ×100 (0 → 100, ~8 → ~0) |
| Täckning | 0.20 | M3G-stationsantal mot referensmål (SE 70 / NO 45 / DK 25 / FI 45 / IS 25) | `antal/mål` ×100 |

**Label: ≥75 Hög driftssäkerhet, 55–74,9 Stabil drift, 35–54,9 Uppmärksamhet, <35 Svag,
inget data Okänt.** NORDIC = snitt av de fem länderna (komponenterna var för sig,
poängen över de länder som har en); `drivers` visar per land `XX: poäng (label)` och
`countries` bär de fullständiga per-land-radiena till tabellen.

**Korrelationslagret (`lib/gnss-correlation.js`) är deterministiskt:** anomalier ur
nuvarande snapshot (Kp ≥ 5 → geomagnetisk aktivitet, Galileo USABLE <80 %/<75 %,
pågående NAGU:er med slutdatum efter nu eller saknat slutdatum, elementset med epokålder
>72 h) och storm↔NAGU-kedjor (NOAA:s geomagnetiska händelser × GSC NAGU-start inom ±72 h;
därtill "pågående sammanfall" när Kp ≥ 5 samträffar med aktiv NAGU just nu).
Narrativtexten genereras alltid ur mallen; är `LLM_BASE_URL` satt kan texten berikas via en
OpenAI-kompatibel chat-endpoint (`lib/llm.js`, standardmodell qwen3.8-flash-next) – LLM:n är
enbart presentation: fel eller saknad konfiguration faller tillbaka på den deterministiska
texten och sprider sig aldrig till routen (ingen test kräver nätverk).

**Kollektorer och flöden (alla nyckelfria):**

- **NOAA SWPC** (`noaa.js`, sedan M2) – `planetary_k_index_1m.json` + `f107_cm_flux.json`;
  Kp ≥ 5 → geomagnetisk stormhändelse. Förser stabilitet i indexet.
- **CelesTrak GP** (`celestrak.js`) – `gp.php?GROUP=…&FORMAT=json` för fyra grupper (galileo,
  glo-ops, sbas, gps-ops); JSON-format krävs för räkning; epokerna kommer utan tidszon
  ("2026-11-08T14:32:11") och är UTC → zongas innan ålderberäkning; epokålder >72 h →
  warn-händelse (SBAS uppdateras glesare än GNSS-kärnorna); ett retry per grupp vid
  transienta fel, 1,2 s takt (`CELESTRAK_DELAY_MS`).
- **GSC Europa** (`gsc-europa.js`) – RSS-feeden (`/rss.xml`, NAGU-adviseringar med start/slut
  och severitet; "USABLE AS FROM" räknas som återställd/info) + konstellationssidan
  (HTML-tabell: status USABLE/…, klocktyp PHM, NAGU-flagga per GSAT). NAGU-blockens HTML-taggar
  görs om till radbrytningar innan taggborttagningen. 15-minutershämtning.
- **M3G GNSS Stations API** (`gnss-metadata.js`) – EPOS sitelog-sökning svarar GeoJSON med max
  20 features per anrop och varken `limit`/`page`/`offset` fungerar (verifierat live) → varje
  land hämtas via ett fast bbox-rutnät och en ruta som svarar med exakt 20 (mättad) delas en
  gång i fyra kvadranter; är kvadranterna fortfarande mättade rapporteras landets antal som
  "(minst)" (≥). API:t använder trebokstaviga koder (SWE…) – recorderna får northwatch
  tvåbokstaviga (SE…). Stationsfeatures blir kartposter (`type: 'gnss-station'`). CC BY 4.0 –
  citera doi:10.24414/ROB-GNSS-M3G (panelen bär tillkännagivandet).
- **data.norge.no** (`datanorge.js`) – GNSS-registerantal via DigDir:s Felles datakatalog
  (samma sök-API som M11:s `fdk`): `POST /search/datasets` med frågorna "gnss" och
  "posisjonering"; `page.totalElements` är det sanna antalet. Delar FDK: ~10 rpm-begränsning →
  6,5 s takt (`DATANORGE_DELAY_MS`). Veckohämtning.
- **NASA APOD** (`nasa-apod.js`) – WordPress wp-json-endpointen `apod-basic`; publiceringstakt
  ≤10 dagar + ålder på senaste inlägget; information enbart, ingår inte i indexet.

Uteslutna/framtidiga: Space-Track (kräver konto + användaravtal), ESA SWE HAPI (precis
ephemerid/klockdrift; kräver M2M-klient hos ESA Single Sign-On, token med scope
`swe_hapiserver` och 300 s livslängd), Lantmäteriets SWEPOS RINEX (registrerad nyckel, CC0)
och FINPOS rådata (licensbelagd); DK GNSS RINEX serveras över FTPS som node-fetch inte
stödjer. Copernicus Data Space och EDAS uteslöts efter endpoint-verifiering – svag direkt
relevans för nordisk positioneringsberedskap. Island: althingi.is svarar 403/unreachable →
täckes via M3G:s ISL-stationsnät i stället för en nationell registerkälla.

**API:** `/api/gnss/status?country=` (beräknat GNSS-index + komponenter + drivfaktorer; NORDIC
ger dessutom `countries`) och `/api/gnss/data?country=ALL|<land>` (records per källa +
källstatus för panelerna; landsvy inkluderar NORDIC-records) – båda synkrona derivationer ur
`store.js`. `/api/gnss/correlation` är asynkron (valfri LLM-berikelse) och pollas av sin egen
panel.

**Frontend:** `GnssView` (två 120 s-feeds: status + data, dependens på valt land) distribuerar
records + `meta {loading, error, fetchedAt, onRetry}` till presentationella paneler
(`GnssPanels.jsx`) – en per källa (NOAA, CelesTrak, GSC Europa, M3G, data.norge.no, APOD) +
statuspanelen och korrelationspanelen (egen feed). Landsvyn visar globala källor + nationella
register; nordiksvyn visar sammanfattning + samtliga källor + luckkort. GNSS-stationerna
renderas i MapPanel via `/api/assets?area=10` (nytt lager "GNSS-station (M3G)"). Datafelet
visar fel i alla sex recordbaserade panelerna (records blir null, inte []), tom källista →
panelens fallbacktext, retry hämtar datat igen.

**Live-status 2026-11-09:** samtliga fem nya källor verifierade live. CelesTrak: Galileo 32 /
GLONASS 28 / SBAS 21 / GPS 32 satelliter. GSC: 32 GSAT i konstellationen, 28 USABLE (87,5 %),
24 med PHM-klocka, 1 öppen NAGU. M3G: SWE 70 / NOR 25 / DNK 22 / FIN 24 stationer, ISL 53
"(minst)" – totalt 194 kartposter. APOD: 10 publiceringar ≤10 d, senaste inlägget 0,8 d gammalt.
data.norge.no: "gnss" 3 dataset (alla publika), "posisjonering" 1 dataset. Fixtures i
`server/testdata/gnss/` är formverifierade mot live med syntetiska värden; index-regressionankar
(Kp=5): SE 74,6 / NO 59,3 / DK 68,9 / FI 64,9 / IS 74,9 / NORDIC 68,5.

**Tester:** `server/test/gnss.test.js` (40 tester: renfunktioner – gpUrl/newestEpoch/
`parseNagu`/`parseConstellation`/`parseStation`/Kp-skala/NAGU-räkning/index med viktnings-
renormalisering + kollektorer mot fixtures med URL-rutad fetch-mock, inklusive CelesTrak-503-retry,
M3G-rutnätsdelning (mättad ruta → kvadranter) och "(minst)"-markering samt FDK-frågrouting –
inget nätverk) + webbtest (`GnssPanels.test.jsx`, 30 tester – alla panelers ok/fel/loading-lägen +
`GnssView`:s koppling till `/api/gnss/*` och datafel som propagerar till de sex panelerna).

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
NVD_API_KEY=…        # valfri – höjer NVD:s rate-limit (5→50 anrop/30 s), kortar
                      #   sidfördröjningen och exponerar databastotalen på /api/cyber/nvd (M9)
OSV_WATCH_PACKAGES=… # M9 – OSV.dev-watchlist "Ecosystem:Paket;…" (26 kurerade paket
                      #   som standard; Maven delas på första kolon, t.ex. "Maven:log4j:log4j-core")
COMTRADE_API_KEY=…  # M10 – UN Comtrade, gratis: comtradeplus.un.org (header
                     #   Ocp-Apim-Subscription-Key, ~500 anrop/dag). Utan nyckel:
                     #   rate-limiteda preview-endpointen (4 s paus, COMTRADE_PREVIEW_DELAY_MS)
COMTRADE_KEYED_DELAY_MS=…  # M10 – takt mellan keyed-anropen (standard 2000 ms)
COMTRADE_RETRY_MAX=…  # M10 – retryar på transients 429/5xx (standard 2 → 3 försök)
NVE_API_KEY=…        # M4 – NVE HydAPI, gratis: https://hydapi.nve.no (header X-API-Key)
NVE_STATIONS=…       # M4 – valfri fast stationslista "6.10.0,..." (annars hämtas
                     #   NVE_STATION_LIMIT första aktiva stationerna, standard 5)
CDS_TOKEN=…          # M4 – Copernicus CDS, gratis: https://cds.climate.copernicus.eu/profile
CDS_EMAIL=…          # M4 – kontots e-post (CDS kräver token + e-post per anrop)
SMHI_FCST_API_BASE=… # M8 – SMHI snow1g-basURL (standard: officiell, nyckelfri)
SMHI_FCST_POINTS=…   # M8 – "Namn=lon,lat,..." (längd först); standard 11 katalogstäder
SMHI_FCST_PARAMS=…   # M8 – koma-separerade punktparametrar (15 standard)
SMHI_GRID_DOWNSAMPLE=…  # M8 – 1–20 (standard 20 → 48×54-raster, ~50 km-avstånd)
SMHI_FCST_CACHE_DIR=…   # M8 – diskcache (standard server/cache/smhi-forecast)
LLM_BASE_URL=…          # M12 – VILJORIG OpenAI-kompatibel chat-endpoint för GNSS-narrativet
                        #   (t.ex. Ollama: http://localhost:1234/v1). Saknas → LLM-berikelsen är
                        #   avstängd; deterministisk malltext används alltid som fallback
LLM_MODEL=…             # M12 – modellnamn (standard qwen3.8-flash-next)
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
- **M8 (klart 2026-11-05):** väderprognos (SMHI snow1g, område 11) –
  kollektorn pollar `createdtime.json` var 5:e minut, 15 parametrars
  tidsserier för 11 katalogstäder, retention av de 12 senaste cyklarna på
  disk, fyra nya `/api/forecast`-endpointar, härledda väderhändelser
  (kompenserar ibww:s 503 sedan 2026-11-01), handgjorda SVG-grafer
  (sex serier + gemensam tidsskrov), prognosrutnät som imageOverlay
  (ds20 ≈ 50 km-avstånd) och klick-överallt-punktprognos. Enhetstester mot
  live-fixtures + webbtest för alla nya moduler (totalt 14 filer, 138 webb-
  tester). Se "Väderprognos (M8, område 11)".

- **M9 (klart 2026-11-06):** cybersäkerhetsdashboardet (område 5) – nytt delat
  cyberdatslager (`lib/cyber.js`, samma mönster som `lib/forecast.js`: inminnescache
  + TTL + in-flight-dedupe) bakom fem nya endpointar: `/api/cyber/nvd` (publicerade
  CVE, 30-dagarsfönster hämtat som 7-dagars-subfönster nyast först – NVD returnerar
  pubDate-fönster äldst först så en enda paginering passerar aldrig de senaste
  dagarna; `capped`-flagga när pagineringsspärrar klipper), `/api/cyber/kev` (hela
  KEV-katalogen med 90-dagars-/ransomware-/frist-KPI:er och 12-månaders-histogram),
  `/api/cyber/osv` (OSV.dev, ny källa: `POST /v1/query` per paket mot 26 kurerade
  paket för kritisk infrastruktur, 180-dagarsfönster, paketvisa fel tolereras),
  `/api/cyber/prioritized` (de senaste 15 KEV-tillägg enriched med CVSS från NVD –
  30-dagarscachet först, sedan enskild `?cveId=`-slagning med 24 h-cache) och
  `/api/cyber/overview` (snittar bara cacherna). Område 5:s generiska
  indikator-/händelse-tabeller ersätts av fyra interaktiva widgetar (120 s-polling,
  sökning, filter, expanderade rader) – övriga 11 områden oförändrade. Kollektorerna
  `nvd`/`kev` flyttades på det delade lagret och `osv` tillkom som 35:e källan.
  Servertester mot live-fixtures (server/test/cyber.test.js, 36 st) + webbtest för
  panelerna och kopplingen (cyberPanels.test.jsx, DashboardPage). Allt verifierat
  live 2026-11-06.

- **M10 (klart 2026-11-07):** industrikedjan (område 7) – fem nya kollektorer:
  Eurostat SDMX 2.1 (sju industri-/råvaruflöden via contentconstraint-drivena
  keyqueries), OECD råstålkapacitet (Mt, SDMX CSV), JRC RMIS/EU CRMs (kritiska
  råvaror med importberoendelarm), UN Comtrade varuhandel (gratis preview-läge
  eller fullt API med gratis `COMTRADE_API_KEY` från comtradeplus.un.org) och
  Statistics Iceland varuhandel (pxwebapi v1). Rent analyslager `lib/industry.js`
  beräknar 0–100-poäng per land + NORDIC i tre komponenter (produktion 0.5 /
  handel 0.3 / kapacitet 0.2, vikterna renormaliseras vid saknad komponent) ur
  de normaliserade recordsen; två synkrona endpointar `/api/industry/status` +
  `/api/industry/data`. Frontend: per-källa-paneler (Eurostat, OECD, Comtrade,
  RMIS, nationella byråer) + statuswidget – landsvy detalj, nordisk vy
  sammanfattning + luckkort (IEA, Stats Denmark, Comtrade-nyckel) – ersätter de
  generiska tabellerna; övriga 11 områden oförändrade. Eurostats data-API var
  systembrett nede under dagen → datafixtures CC-formverifierade med
  syntetiska värden (canary dokumenterad); OECD/RMIS/Comtrade (preview)/Statice
  verifierade live 2026-11-07. Servertester (industry.test.js, 41 st) +
  webbtest (industryPanels.test.jsx + DashboardPage) – fulla suite grön:
  166 servertester, 24 webbfiler / 226 webbtester. Se "Industri (M10, område 7)".

- **M11 (klart 2026-11-08):** offentlig förvaltning (område 12) – sju nya
  kollektorer, alla nyckelfria: Sveriges riksdag (kammarkalendern JSON +
  votering/anförande-zips + personregister; egen nollberoendeläsare
  `lib/zip.js` – zipsens UTF-8-filnamn bryter `unzip`), DigDir:s Felles
  datakatalog (söks-API, CC0, 10 rpm → 6 s takt), Retsinformation (explicita
  `?date=`-anrop, sju dagar; helger tomma = data), Finlex (AKN-listor,
  ettrabaserad paginering utan totalt, avdubblad språkversioner, progressiv
  429-backoff med bevarat delvis totalt "(estimat)"),
  IPU Parline (parlament som 5-länders bas, `filter=`-syntax, CC BY-NC-SA 4.0),
  data.europa.eu hub-sök (`facets`/`countOnly`) och EUR-Lex/Cellar SPARQL
  (CELEX `32YYYY`-räkning). Rent analyslager `lib/forvaltning.js` beräknar
  Förvaltningsindex 0–100 per land + NORDIC i tre komponenter (aktivitet 0.4 /
  kontinuitet 0.3 / observerbarhet 0.3, per-källa mätare + datafreshness;
  vikterna renormaliseras vid saknad källa); två synkrona endpointar
  `/api/forvaltning/status` + `/api/forvaltning/data`. Frontend: per-källa-paneler
  + statuswidget – landsvy detalj (IS: luckkort – ingen nationell källa),
  nordisk vy sammanfattning + luckkort – ersätter de generiska tabellerna;
  övriga 11 områden oförändrade. Plus fix av existerande setTimeout-överskott
  i `lib/scheduler.js` (månadstakter > 2^31-1 ms clampades av Node till 1 ms →
  back-to-back-polling; delay kläms nu, scheduler.test.js). Samtliga sju
  källor verifierade live 2026-11-08/09. Servertester (forvaltning.test.js,
  38 st + scheduler.test.js, 2 st) + webbtest (ForvaltningPanels.test.jsx,
  28 st) – fulla suite grön: 215 servertester (1 förväntad skip), 26
  webbfiler / 279 webbtester. Se "Förvaltning (M11, område 12)".

- **M12 (klart 2026-11-09):** rymd/navigation/positionering (område 10) – fem nya
  nyckelfria kollektorer: CelesTrak GP (fyra konstellationers elementset, JSON-format,
  epokålder >72 h → varning), GSC Europa (RSS NAGU + konstellationssidan HTML-tabell
  USABLE/PHM), M3G GNSS Stations API/EPOS (stationsmetadata fem länder via bbox-rutnät
  eftersom API:t har 20 features/anrop som hårdkodad gräns och ignorerar paginering;
  mättade rutor delas en nivå, därefter "(minst)"; stationerna blir kartposter),
  data.norge.no/Felles datakatalog (GNSS-registerantal via FDK:s sök-API) och NASA APOD
  wp-json (publiceringstakt, information enbart). Rent analyslager `lib/gnss.js` beräknar
  GNSS-index 0–100 per land + NORDIC i fyra komponenter (tillgänglighet 0.35 / stabilitet
  0.25 / varningstäthet 0.20 / täckning 0.20; renormaliserade vid saknad komponent);
  `lib/gnss-correlation.js` deriverar deterministiskt anomalier och storm↔NAGU-kedjor
  (±72 h) med valfri LLM-berikelse av narrativet via `lib/llm.js` (OpenAI-kompatibel
  endpoint, standard qwen3.8-flash-next; avstängd utan `LLM_BASE_URL`, fel sprider sig
  aldrig). Endpointar `/api/gnss/status` + `/api/gnss/data` (synkrona) och
  `/api/gnss/correlation` (asynkron). Frontend: per-källa-paneler + statuswidget +
  korrelationspanel – landsvy detalj, nordisk vy sammanfattning + luckkort (SWEPOS/
  FINPOS/DK-RINEX-nycklar, Space-Track/SWE HAPI-konton, Island via M3G) – ersätter de
  generiska tabellerna; övriga 11 områden oförändrade. NOAA SWPC (M2) förser nu stabilitet
  i indexet och MapPanel har nytt GNSS-stationslager. Samtliga fem nya källor verifierade
  live 2026-11-09. Servertester (gnss.test.js, 40 st) + webbtest (GnssPanels.test.jsx,
  30 st) – fulla suite grön: 255 servertester (1 förväntad skip), 27 webbfiler / 309 webbtester.
  Se "GNSS/Rymd (M12, område 10)".

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
- NIST NVD (M9): rate-limit 5 anrop/30 s utan API-nyckel, 50 med (gratis nyckel på
  nvd.nist.gov). Datslagret håller sidfördröjning (7 s/2 s) och en sidbudget per
  7-dagars-subfönster; fönstret cachas i minnet 15 min. `capped=true` signalerar att
  pagineringsspärren klippde ett subfönster (talen är då en undervarning).
- OSV.dev (M9): nyckelfritt. `POST /v1/query` per paket med 400 ms-fördröjning
  (26 paket ≈ 15 s/cykel) och ett retry-försök vid tomt svar; watchlisten
  (`OSV_WATCH_PACKAGES`) uppdateras var 6:e timme.
- CISA KEV (M9): publikt JSON, ingen nyckel. Hela katalogen cachas i minnet 6 timmar
  (används för prioritering, ej incidentdetektion).
- UN Comtrade (M10): dokumenterat på comtradeplus.un.org/ApiDocs. Preview-API:t
  är gratis men hårt rate-limited (429 vid snabba upprepningar) → 4 s paus mellan
  anropen (`COMTRADE_PREVIEW_DELAY_MS`, standard 4000). Gratis `COMTRADE_API_KEY`
  (comtradeplus.un.org, ~500 anrop/dag) växlar till fullt data-API; nyckeln skickas
  som `Ocp-Apim-Subscription-Key`, bara i `.env`. Båda produkterna är
  querystring-baserade (`period` = 4-siffrigt år) och keyed-svaret bryts ner på
  `motCode`×`partner2Code` med `isAggregate` true på alla rader → totalraden
  väljs klientsida via `motCode=0 && partner2Code=0`.
- Eurostat SDMX 2.1 (M10): öppet API, ingen nyckel. Data hämtas via
  contentconstraint + per-flödes keyqueries (skonsamt). Data-API:t var systembrett
  nede 2026-11-07 – canary och status, se "Industri (M10, område 7)".
- Statistics Iceland (M10): 429 vid anrop tättare än ~8 s → 9 s paus mellan
  struktur- och datafrågan (`STATICE_DELAY_MS`, standard 9000).
- Sveriges riksdag (M11): nyckelfri öppendata; ange alltid Sveriges riksdag som
  källa. Zipsens UTF-8-filnamn läses av `lib/zip.js` (macOS `unzip` fastnar).
- DigDir Felles datakatalog (M11): CC0. Söks-API:t är officiellt internt/instabilt;
  10 rpm (burst 20) → 6 s takt mellan anropen (`FDK_DELAY_MS`, nollas i tester).
- Retsinformation (M11): nyckelfri. `?date=` max 10 dagar bakåt, dagens data
  klippad 03:00; sju anrop per körning med 1,2 s takt (`RTI_DELAY_MS`).
  Instabilt API (non-JSON/tom kropp) → 3 försök per dag med progressiv paus;
  kvarvarande fel → "hämtfel"-record, totalt blir delvis.
- Finlex (M11): nyckelfri men User-Agent krävs. 429 (rate limit; fönstret
  öppnas efter ~30 s) → progressiv backoff, kumulativt 5/15/30 s; misslyckad
  sida → bevarat delvis totalt "(estimat)". Pagineringsatak `FINLEX_MAX_PAGES`
  (standard 350) → "(estimat)".
- IPU Parline (M11): datat är CC BY-NC-SA 4.0 → källtillkännagivande gäller
  (panelen bär tillkännagivandet). Bar query-parametrar ignoreras –
  `filter=<fält>:<op>:<värde>`; 20 anrop per körning med 1 s takt
  (`IPU_DELAY_MS`).
- data.europa.eu (M11): nyckelfri; billiga räkningar via `countOnly=true`;
  3 anrop/land med 1,5 s takt (`DATAPORTAL_DELAY_MS`).
- EUR-Lex/Cellar (M11): EU:s upphovsrätt – fri återanvändning mot
  källtillkännagivande ("Publications Office of the European Union").
- CelesTrak GP (M12): nyckelfri; `FORMAT=json` krävs för räkning, epoker utan tidszon är UTC.
  1,2 s takt mellan grupperna (`CELESTRAK_DELAY_MS`, nollas i tester), ett retry per grupp.
- GSC Europa (M12): nyckelfri RSS + HTML-konstellationssida; NAGU-adviseringarna är
  Galileo/EGNOS egen störningsrapportering (källan för varningstäthet i GNSS-indexet).
- M3G GNSS Stations API (M12): CC BY 4.0 – citera doi:10.24414/ROB-GNSS-M3G (panelen bär
  tillkännagivandet). Max 20 features/anrop och `limit`/`page` ignoreras → fast bbox-rutnät +
  en nivå kvadrantsdelning; ~40 anrop per daglig körning med 0,25 s takt (`M3G_DELAY_MS`,
  nollas i tester).
- NASA APOD (M12): nyckelfri wp-json-endpoint (`apod-basic`); information enbart.
- data.norge.no GNSS-sökning (M12): samma FDK-söks-API som M11 → delar ~10 rpm-begränsningen;
  6,5 s takt mellan frågorna (`DATANORGE_DELAY_MS`, nollas i tester).
- LLM (M12): valfri berikelse av korrelationsnarrativet via OpenAI-kompatibel endpoint
  (`LLM_BASE_URL` + `LLM_MODEL`, standard qwen3.8-flash-next, t.ex. Ollama lokalt). Avstängd
  utan konfiguration; krävs aldrig i tester eller för routen – deterministisk malltext är
  alltid fallback.
- Övrigt enligt respektive källas villkor – se API-katalogen
  (`nordic_critical_infrastructure_api_catalog_utokad.xlsx`).
