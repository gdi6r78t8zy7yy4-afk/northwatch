// Källregistret – M1: de källor som finns bekräftade/arbetande i
// API-katalogen (klass A) plus EXISTERANDE collector från skelettet.
// M2 lägger till: entsoe, statnett, energidataservice, dmi, peeringdb,
// eurostat, noaa-swpc, epss, attack (+ M2-verifiering av smhi-warnings
// och digitraffic-på vägarna).
import smhi from './smhi.js';
import smhiWarnings from './smhi-warnings.js';
import metno from './metno.js';
import kev from './kev.js';
import nvd from './nvd.js';
import svk from './svk.js';
import fingrid from './fingrid.js';
import trafikverket from './trafikverket.js';
import digitraffic from './digitraffic.js';

export const COLLECTORS = [
  smhi,
  smhiWarnings,
  metno,
  kev,
  nvd,
  svk,
  fingrid,
  trafikverket,
  digitraffic,
];
