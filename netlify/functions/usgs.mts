/**
 * /api/usgs → caudal instantáneo (parámetro 00060, cfs) de todas las estaciones del catálogo, últimos 7 días,
 * en una sola consulta a USGS Water Services. Se agrupa por hora para achicar la respuesta.
 * Cache CDN 15 min.
 * Nota: USGS anunció que waterservices.usgs.gov se da de baja en el 1er trimestre de 2027
 * (reemplazo: api.waterdata.usgs.gov). Antes de esa fecha hay que migrar esta función.
 */
import type { Config } from "@netlify/functions";
import catalog from "../../src/data/catalog.json";
import { parseUsgsIv } from "../../src/shared/process";

const IDS: string[] = (catalog as any).gauges.map((g: any) => g.id);
const UA = "rio-colorado-monitor/1.0 (monitoreo hidrologico personal; cache 15 min)";

function out(body: unknown, status: number, cdn: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300", "netlify-cdn-cache-control": cdn },
  });
}

export default async () => {
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${IDS.join(",")}&parameterCd=00060&period=P7D&siteStatus=all`;
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) return out({ error: `USGS HTTP ${r.status}` }, 502, "public, s-maxage=120");
    const gauges = parseUsgsIv(await r.json());
    return out({ fetchedAt: new Date().toISOString(), gauges }, 200, "public, durable, s-maxage=900, stale-while-revalidate=3600");
  } catch (e: any) {
    return out({ error: e?.name === "AbortError" ? "USGS no respondió a tiempo" : String(e?.message || e) }, 502, "public, s-maxage=120");
  } finally {
    clearTimeout(to);
  }
};

export const config: Config = { path: "/api/usgs" };
