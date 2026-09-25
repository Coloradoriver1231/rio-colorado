/**
 * /api/outlook → lo que viene: pronóstico 10 días (Open-Meteo, no oficial) + perspectiva de 3 meses de NOAA CPC (oficial).
 * Cache CDN 3 h (Open-Meteo se actualiza varias veces por día; CPC una vez por mes).
 */
import type { Config } from "@netlify/functions";
import { readJson } from "../lib/blob";
import { json } from "../lib/net";
import { cpcOutlook, pickPoints, REGIONS, weather10 } from "../lib/outlook";
import type { Station } from "../lib/snow";

export default async () => {
  const stations = await readJson<Station[]>("snotel-stations");
  const points = pickPoints(stations);
  const [weather, cpc] = await Promise.all([weather10(points), cpcOutlook()]);
  if (!weather && cpc.error === "NOAA CPC no respondió") return json({ error: "No respondieron ni Open-Meteo ni NOAA CPC" }, 502, "public, s-maxage=120");
  return json(
    { weather, weatherError: weather ? null : "Open-Meteo no respondió", points: points.length, regions: REGIONS, cpc },
    200,
    weather && !cpc.error ? "public, durable, s-maxage=10800, stale-while-revalidate=21600" : "public, s-maxage=600",
  );
};

export const config: Config = { path: "/api/outlook" };
