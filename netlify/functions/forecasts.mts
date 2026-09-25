/**
 * /api/forecasts → pronósticos oficiales de volumen (NRCS/CBRFC) de TODOS los puntos de la cuenca del Colorado
 * (HUC 14 y 15): entradas a embalses (Flaming Gorge, Blue Mesa, Navajo, McPhee, Granby, Dillon…) y ríos.
 * Para cada punto: la última publicación del año hidrológico y el período que cubre. Cache CDN 6 h.
 */
import type { Config } from "@netlify/functions";
import { get, json } from "../lib/net";
import { isoDay, waterYear, wyStartOf } from "../lib/snow";
import { HUC4 } from "../lib/hydro";

const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";

export interface FcPoint {
  id: string; name: string; river: string; huc4: string; subbasin: string; basin: "alta" | "baja"; reservoir: boolean;
  publicationDate: string | null; period: [string, string] | null; unit: string | null; normal: number | null;
  values: Record<string, number>; history: number;
}

export function parseForecastGroups(arr: any): Map<string, { name: string | null; recs: any[] }> {
  const out = new Map<string, { name: string | null; recs: any[] }>();
  if (!Array.isArray(arr)) return out;
  for (const g of arr) {
    const id = String(g?.stationTriplet || "");
    if (!id || !Array.isArray(g.data)) continue;
    out.set(id, { name: g.forecastPointName ? String(g.forecastPointName).trim() : null, recs: g.data });
  }
  return out;
}

export default async () => {
  const today = isoDay(Date.now());
  const wy = waterYear(today);
  const st = await get(`${AWDB}/stations?stationTriplets=*:*:USGS,*:*:BOR&hucs=14*,15*&returnForecastPointMetadata=true&activeOnly=true`, "json", 9000);
  if (!Array.isArray(st)) return json({ error: "NRCS no respondió la lista de puntos de pronóstico" }, 502, "public, s-maxage=120");
  const pts = st.filter((s: any) => s?.forecastPointMetadata && /^1[45]/.test(String(s.huc || "")));
  const ids: string[] = pts.map((s: any) => String(s.stationTriplet));
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
  const got = await Promise.all(chunks.map((c) =>
    get(`${AWDB}/forecasts?stationTriplets=${encodeURIComponent(c.join(","))}&elementCodes=SRVO&beginPublicationDate=${wyStartOf(wy)}&endPublicationDate=${today}`, "json", 9000)));
  const groups = new Map<string, { name: string | null; recs: any[] }>();
  let failed = 0;
  for (const g of got) { if (!Array.isArray(g)) failed++; for (const [k, v] of parseForecastGroups(g)) groups.set(k, v); }

  const points: FcPoint[] = pts.map((s: any) => {
    const id = String(s.stationTriplet);
    const huc = String(s.huc);
    const g = groups.get(id);
    const recs = (g?.recs || [])
      .filter((r: any) => r?.forecastValues && Array.isArray(r.forecastPeriod))
      .sort((a: any, b: any) => (String(a.publicationDate) < String(b.publicationDate) ? -1 : 1));
    const last = recs.length ? recs[recs.length - 1] : null;
    const fpName = String(s.forecastPointMetadata?.name || g?.name || s.name || id).trim();
    return {
      id, name: fpName, river: String(s.name || ""), huc4: huc.slice(0, 4), subbasin: HUC4[huc.slice(0, 4)] || huc.slice(0, 4),
      basin: huc.startsWith("14") ? "alta" : "baja", reservoir: /inflow/i.test(fpName),
      publicationDate: last ? String(last.publicationDate).slice(0, 10) : null,
      period: last ? [String(last.forecastPeriod[0]), String(last.forecastPeriod[1])] : null,
      unit: last ? String(last.unitCode || "") : null,
      normal: last && Number.isFinite(last.periodNormal) ? Number(last.periodNormal) : null,
      values: last ? Object.fromEntries(Object.entries(last.forecastValues).filter(([, v]) => Number.isFinite(v as number))) as Record<string, number> : {},
      history: recs.length,
    };
  });
  return json({ fetchedAt: new Date().toISOString(), wy, failedChunks: failed, points }, 200, failed ? "public, s-maxage=600" : "public, durable, s-maxage=21600, stale-while-revalidate=43200");
};

export const config: Config = { path: "/api/forecasts" };
