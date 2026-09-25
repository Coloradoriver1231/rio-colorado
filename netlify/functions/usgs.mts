/**
 * /api/usgs → caudal (cfs) de todas las estaciones del catálogo, últimos 7 días, serie horaria.
 * Devuelve lo que guardó la función programada (usgs-refresh, cada 15 min). Sólo si todavía no hay nada guardado
 * (recién publicado) consulta USGS en el momento.
 */
import type { Config } from "@netlify/functions";
import { fetchUsgs, loadSaved, merge, save } from "../lib/usgs";

function out(body: unknown, status: number, cdn: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120", "netlify-cdn-cache-control": cdn },
  });
}

export default async () => {
  let saved = await loadSaved();
  if (!saved || !Object.keys(saved.gauges).length) {
    const r = await fetchUsgs(8500);
    saved = merge(saved, r.gauges, new Date(), r.errors);
    await save(saved);
  }
  const n = Object.keys(saved.gauges).length;
  const stale = Date.now() - Date.parse(saved.savedAt) > 40 * 60e3;
  const meta = { fetchedAt: saved.savedAt, lastRunAt: saved.lastRunAt ?? null, errors: saved.lastErrors ?? [] };
  if (!n) return out({ error: `USGS no responde (${meta.errors.join("; ") || "sin datos"})`, ...meta }, 502, "public, s-maxage=60");
  return out({ ...meta, gauges: saved.gauges, stale }, 200, stale ? "public, s-maxage=60" : "public, durable, s-maxage=300, stale-while-revalidate=600");
};

export const config: Config = { path: "/api/usgs" };
