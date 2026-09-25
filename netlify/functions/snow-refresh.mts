/** Programada cada 3 h: estado de nieve y precipitación (SNOTEL) + pronóstico oficial de Powell → Netlify Blobs. */
import type { Config } from "@netlify/functions";
import { writeJson } from "../lib/blob";
import { buildStatus } from "../lib/snow";

export default async () => {
  const s = await buildStatus();
  if (s) await writeJson("snow-status", s);
  console.log(s ? `snow-refresh: ${s.stations.length} estaciones, ${s.forecasts.length} pronósticos` : "snow-refresh: NRCS no respondió");
};

export const config: Config = { schedule: "7 */3 * * *" };
