/**
 * /api/usbr/<site>  →  resumen de un embalse con datos diarios del Bureau of Reclamation (USBR).
 * Fuente: https://www.usbr.gov/uc/water/hydrodata/reservoir_data/<site>/json/<datatype>.json
 *   17 = almacenamiento (acre-feet), 29 = entrada media diaria (cfs),
 *   42 = salida total media diaria (cfs), 49 = cota (pies)
 * La respuesta queda en el CDN de Netlify 1 h (USBR publica una vez por día).
 * Sólo se aceptan embalses del catálogo.
 */
import type { Config } from "@netlify/functions";
import catalog from "../../src/data/catalog.json";
import { parseHydrodata, summarize, type SeriesSummary } from "../../src/shared/process";

const ALLOWED = new Set<number>((catalog as any).reservoirs.map((r: any) => r.site));
const BASE = "https://www.usbr.gov/uc/water/hydrodata/reservoir_data";
const TYPES = { storage: 17, inflow: 29, release: 42, elevation: 49 } as const;
const UA = "rio-colorado-monitor/1.0 (monitoreo hidrologico personal; cache 1 h)";

type Key = keyof typeof TYPES;

async function getSeries(site: number, dt: number, signal: AbortSignal): Promise<{ pts: any } | { error: string; missing?: boolean }> {
  try {
    const r = await fetch(`${BASE}/${site}/json/${dt}.json`, { headers: { "user-agent": UA, accept: "application/json" }, signal });
    if (r.status === 404) return { error: "no publicada", missing: true };
    if (!r.ok) return { error: `USBR HTTP ${r.status}` };
    return { pts: parseHydrodata(await r.json()) };
  } catch (e: any) {
    return { error: e?.name === "AbortError" ? "USBR no respondió a tiempo" : String(e?.message || e) };
  }
}

export default async (req: Request) => {
  const m = new URL(req.url).pathname.match(/^\/api\/usbr\/(\d{1,7})$/);
  const site = m ? Number(m[1]) : NaN;
  if (!ALLOWED.has(site)) return new Response(JSON.stringify({ error: "embalse no permitido" }), { status: 404, headers: { "content-type": "application/json" } });

  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 8500);
  const series: Partial<Record<Key, SeriesSummary | null>> = {};
  const errors: Partial<Record<Key, string>> = {};
  let hardErrors = 0;
  try {
    await Promise.all(
      (Object.keys(TYPES) as Key[]).map(async (k) => {
        const res = await getSeries(site, TYPES[k], ctl.signal);
        if ("pts" in res) {
          series[k] = summarize(res.pts, k === "storage" || k === "elevation");
        } else {
          series[k] = null;
          errors[k] = res.error;
          if (!res.missing) hardErrors++;
        }
      }),
    );
  } finally {
    clearTimeout(to);
  }

  const ok = Object.values(series).some((s) => s);
  const body = JSON.stringify({ site, fetchedAt: new Date().toISOString(), series, errors });
  return new Response(body, {
    status: ok ? 200 : hardErrors ? 502 : 404,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      // con errores de red no se cachea mucho, para reintentar pronto
      "netlify-cdn-cache-control": ok && hardErrors === 0 ? "public, durable, s-maxage=3600, stale-while-revalidate=86400" : "public, s-maxage=120",
    },
  });
};

export const config: Config = { path: "/api/usbr/:site" };
