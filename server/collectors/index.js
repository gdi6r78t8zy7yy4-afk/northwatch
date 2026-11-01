// Källregistret – 18 källor: M1 (9) + M2 (9).
// M2 (2026-11-01): entsoe, statnett, energidataservice, peeringdb, eurostat,
// noaa, epss, attack, dmi. Digitraffic verifierad mot v1/messages;
// Trafikverkets gamla API är nedlagt server-side (se kollektorn).
import smhi from './smhi.js';
import smhiWarnings from './smhi-warnings.js';
import metno from './metno.js';
import kev from './kev.js';
import nvd from './nvd.js';
import svk from './svk.js';
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
  fingrid,
  entsoe,
  statnett,
  energidataservice,
  trafikverket,
  digitraffic,
  peeringdb,
  eurostat,
  noaa,
];
