/**
 * /api/snow → estado de nieve/precipitación + pronóstico oficial + estimación del monitor.
 * Lee lo que guardan las funciones programadas (cada hora). Si todavía no corrieron (recién publicado),
 * arma en el momento una versión liviana (últimos 32 días) y la guarda; la estimación se calcula sólo en la programada.
 */
import type { Config } from "@netlify/functions";
import { readJson, writeJson } from "../lib/blob";
import { json } from "../lib/net";
import { buildStatus, type ModelOut, type SnowStatus, type Station } from "../lib/snow";

export default async () => {
  let [status, model, known] = await Promise.all([
    readJson<SnowStatus>("snow-status"),
    readJson<ModelOut>("snow-model"),
    readJson<Station[]>("snotel-stations"),
  ]);
  if (!status) {
    const s = await buildStatus(Date.now(), true, known);
    if (s) {
      if (s.allStations?.length && !known) await writeJson("snotel-stations", s.allStations);
      const { allStations, ...rest } = s;
      status = rest;
      await writeJson("snow-status", rest);
    }
  }
  if (!status && !model)
    return json({ error: "NRCS no respondió a tiempo. La actualización automática corre cada hora; volvé a intentar en unos minutos." }, 502, "public, s-maxage=60");
  return json({ status, model }, 200, status?.light || !model ? "public, s-maxage=120" : "public, durable, s-maxage=900, stale-while-revalidate=3600");
};

export const config: Config = { path: "/api/snow" };
