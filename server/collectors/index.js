// Källregistret – 33 källor: M1 (9) + M2 (9) + M3 (4 OSM/Overpass) + M4 (10)
// + svk-hist. SVK-omskrivning (2026-11-03): svk.js är ombyggd mot de nya
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
import svk from './svk.js';
import svkHist from './svk-hist.js';
import fingrid from './fingrid.js';
import trafikverket from './trafikverket.js';
import digitraffic from './digitraffic.js';
import entsoe from './entsoe.js';
import statnett from './statnett.js';
import energidataservice from './energidataservice.js';
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

export const COLLECTORS = [
  smhi,
  smhiWarnings,
  metno,
  dmi,
  kev,
  nvd,
  epss,
  attack,
  svk,
  svkHist,
  fingrid,
  entsoe,
  statnett,
  energidataservice,
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
];
