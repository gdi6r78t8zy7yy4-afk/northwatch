// Källregistret – 55 källor: M1 (9) + M2 (9) + M3 (4 OSM/Overpass) + M4 (10)
// + svk-hist + smhi-forecast (M8) + kev/nvd/osv (M9) + M10 (5:
// eurostat-industry, oecd, rmis, comtrade, statice) + M11 (7: riksdagen,
// fdk, retsinformation, finlex, ipu, dataportal, cellar) + M12 (5: celestrak,
// gsc-europa, gnss-metadata, nasa-apod, datanorge).
// M12 (2026-11-09): rymd/GNSS-nyckelfri kärna (område 10) – CelesTrak GP
// (elementset för Galileo/GLONASS/SBAS/GPS), GSC (NAGU-RSS + konstellations-
// status), M3G/EPOS (nationella GNSS-stationer som kartassets, Island via
// ISL eftersom althingi.is 403:ar), NASA APOD wp-json och data.norge.no/FDK
// (GNSS-datasetantal). Se README "M12".
// M11 (2026-11-08): offentlig förvaltning (område 12) – Sveriges riksdag
// (kalender + votering/anförande-zips + personregister, vecko), DigDir Felles
// datakatalog (sök-API, vecko), Retsinformation (dansk lagändringar, daglig),
// Finlex (finländsk lagsättning via AKN-URI, vecko), IPU Parline (parlament
// som 5-länders bas, vecko), data.europa.eu hub-sök (månad) och EUR-Lex/Cellar
// SPARQL CELEX-räkning (månad). Se README "M11".
// M10 (2026-11-07): industri-/tillverkningsområdet (7) – Eurostat SDMX 2.1
// (sju flöden, CC-drivena keyqueries), OECD stålkapacitet (SDMX CSV),
// JRC RMIS/EU CRMs (kritiska råvaror), UN Comtrade (preview eller gratisnyckel
// COMTRADE_API_KEY) och Statistics Iceland (pxwebapi v1). Se README "M10".
// SVK-omskrivning (2026-11-03): svk.js är ombyggd mot de nya
// data.svk.se-UUID-resurserna (ingen API-nyckel, CKAN datastore_search) med
// flöden + aFRR/mFRR-leveranser + sista FCR-bidmätningen; svk-hist.js pollar
// de fyra frusna historiska dataseten (FCR-energi/kapacitet/aggregerade
// volymer + dagstima-priser) var 6:e timme. Se README "Källor".
// M2 (2026-11-01): entsoe, statnett, energidataservice, peeringdb, eurostat,
// noaa, epss, attack, dmi. Digitraffic verifierad mot v1/messages;
// M5 (2026-11-02): Trafikverket-omskrivning till datacache-API:t (v2) med
// LOGIN-auth i XML-bodyn, ModifiedTime-polling och TrafficFlow-mätdata;
// se README "Trafikverket (M5)" och kollektorn.
// M3 (2026-11-01): osm-energi/digital/transport/vatten – veckohämtning av
// anläggningspunkter för kartlagren (se osm.js + lib/geolayers.js).
// M4 (2026-11-02): klass B-verifiering enligt API-katalogen – energinet,
// vedur, scb, ssb, statfinland, digitraffic-rail, digitraffic-marine,
// riksbank (öppen yta; datagatewayn ej publikt upptäckbar), nve (X-API-Key),
// cds (CDS_TOKEN + CDS_EMAIL). Se README "Klass B-verifiering (M4)".
import smhi from './smhi.js';
import smhiWarnings from './smhi-warnings.js';
import metno from './metno.js';
import kev from './kev.js';
import nvd from './nvd.js';
import osv from './osv.js';
import svk from './svk.js';
import svkHist from './svk-hist.js';
import fingrid from './fingrid.js';
import elprisetjustnu from './elprisetjustnu.js';
import trafikverket from './trafikverket.js';
import digitraffic from './digitraffic.js';
import entsoe from './entsoe.js';
import statnett from './statnett.js';
import energidataservice from './energidataservice.js';
import energinetLive from './energinet-live.js';
import landsnet from './landsnet.js';
import peeringdb from './peeringdb.js';
import eurostat from './eurostat.js';
import noaa from './noaa.js';
import epss from './epss.js';
import attack from './attack.js';
import dmi from './dmi.js';
import osm from './osm.js';
import energinet from './energinet.js';
import vedur from './vedur.js';
import scb from './scb.js';
import ssb from './ssb.js';
import statfinland from './statfinland.js';
import digitrafficRail from './digitraffic-rail.js';
import digitrafficMarine from './digitraffic-marine.js';
import riksbank from './riksbank.js';
import nve from './nve.js';
import cds from './cds.js';
import smhiForecast from './smhi-forecast.js';
import eurostatIndustry from './eurostat-industry.js';
import oecd from './oecd.js';
import rmis from './rmis.js';
import comtrade from './comtrade.js';
import statice from './statice.js';
import riksdagen from './riksdagen.js';
import fdk from './fdk.js';
import retsinformation from './retsinformation.js';
import finlex from './finlex.js';
import ipu from './ipu.js';
import dataportal from './dataportal.js';
import cellar from './cellar.js';
import celestrak from './celestrak.js';
import gscEuropa from './gsc-europa.js';
import gnssMetadata from './gnss-metadata.js';
import nasaApod from './nasa-apod.js';
import datanorge from './datanorge.js';

export const COLLECTORS = [
  smhi,
  smhiWarnings,
  smhiForecast,
  metno,
  dmi,
  kev,
  nvd,
  osv,
  epss,
  attack,
  svk,
  svkHist,
  fingrid,
  elprisetjustnu,
  entsoe,
  statnett,
  energidataservice,
  energinetLive,
  landsnet,
  trafikverket,
  digitraffic,
  peeringdb,
  eurostat,
  noaa,
  ...osm,
  energinet,
  vedur,
  scb,
  ssb,
  statfinland,
  digitrafficRail,
  digitrafficMarine,
  riksbank,
  nve,
  cds,
  eurostatIndustry,
  oecd,
  rmis,
  comtrade,
  statice,
  riksdagen,
  fdk,
  retsinformation,
  finlex,
  ipu,
  dataportal,
  cellar,
  celestrak,
  gscEuropa,
  gnssMetadata,
  nasaApod,
  datanorge,
];
