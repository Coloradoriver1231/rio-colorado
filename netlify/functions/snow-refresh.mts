/** Programada cada hora: estado de nieve y precipitación (SNOTEL) + pronóstico oficial de Powell → Netlify Blobs. */
import type { Config } from "@netlify/functions";
import { readJson, writeJson } from "../lib/blob";
import { buildStatus, type Station } from "../lib/snow";

export default async () => {
  const known = await readJson<Station[]>("snotel-stations");
  const s = await buildStatus(Date.now(), false, known);
  if (s) {
    if (s.allStations?.length) await writeJson("snotel-stations", s.allStations);
    const { allStations, ...rest } = s;
    await writeJson("snow-status", rest);
  }
  console.log(s ? `snow-refresh: ${s.stations.length} estaciones, ${s.forecasts.length} pronósticos, ${s.failedChunks} tandas fallidas, ${s.ms} ms` : "snow-refresh: NRCS no respondió");
};

export const config: Config = { schedule: "7 * * * *" };
