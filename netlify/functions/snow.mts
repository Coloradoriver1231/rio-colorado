/**
 * /api/snow → estado de nieve/precipitación + pronóstico oficial + estimación del monitor.
 * Lee lo que guardan las funciones programadas. Si todavía no corrieron (recién publicado), calcula en el momento
 * lo que alcance en el tiempo disponible y lo guarda.
 */
import type { Config } from "@netlify/functions";
import { readJson, writeJson } from "../lib/blob";
import { json } from "../lib/net";
import { buildModel, buildStatus, type ModelOut, type SnowStatus } from "../lib/snow";

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((ok) => setTimeout(() => ok(null), ms))]);

export default async () => {
  let [status, model] = await Promise.all([readJson<SnowStatus>("snow-status"), readJson<ModelOut>("snow-model")]);
  if (!status || !model) {
    const [s, m] = await Promise.all([
      status ? Promise.resolve(status) : withTimeout(buildStatus(), 9000),
      model ? Promise.resolve(model) : withTimeout(buildModel(), 9000),
    ]);
    if (!status && s) { status = s; await writeJson("snow-status", s); }
    if (!model && m) { model = m; await writeJson("snow-model", m); }
  }
  if (!status && !model) return json({ error: "Todavía no hay datos de nieve (NRCS no respondió a tiempo). Se reintenta solo cada 3 h." }, 502, "public, s-maxage=60");
  return json({ status, model }, 200, "public, durable, s-maxage=900, stale-while-revalidate=3600");
};

export const config: Config = { path: "/api/snow" };
