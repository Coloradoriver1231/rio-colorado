/**
 * /api/usgs → caudal (cfs) de todas las estaciones del catálogo, últimos 7 días, serie horaria.
 * Lee el último dato guardado por la función programada (usgs-refresh, cada 15 min). Si no hay o tiene
 * más de 30 min, consulta USGS en el momento; si USGS falla, devuelve lo guardado marcado como viejo.
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
  const saved = await loadSaved();
  const age = saved ? Date.now() - Date.parse(saved.savedAt) : Infinity;
  if (saved && age < 30 * 60e3)
    return out({ fetchedAt: saved.savedAt, gauges: saved.gauges, stale: false }, 200, "public, durable, s-maxage=300, stale-while-revalidate=600");

  const r = await fetchUsgs(8500);
  if (Object.keys(r.gauges).length) {
    const m = merge(saved, r.gauges);
    await save(m);
    return out({ fetchedAt: m.savedAt, gauges: m.gauges, stale: false, errors: r.errors }, 200, "public, durable, s-maxage=300, stale-while-revalidate=600");
  }
  if (saved)
    return out({ fetchedAt: saved.savedAt, gauges: saved.gauges, stale: true, errors: r.errors }, 200, "public, s-maxage=60");
  return out({ error: `USGS no responde (${r.errors.join("; ") || "sin datos"})` }, 502, "public, s-maxage=60");
};

export const config: Config = { path: "/api/usgs" };
