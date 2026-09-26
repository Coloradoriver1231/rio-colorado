/**
 * /api/nrcsres/<embalse> → historia de almacenamiento de un embalse que USBR hydrodata no publica
 * (San Carlos, Salt, Verde, Granby, Dillon…), desde NRCS AWDB (RESC, acre-feet).
 * Diario si NRCS lo tiene; si no, mensual. Percentiles 10/50/90 por día (o mes) de los años anteriores. Cache 6 h.
 */
import type { Config } from "@netlify/functions";
import { get, json } from "../lib/net";
import { parseAwdbValues, type Pt } from "../lib/hydro";
import { summarize } from "../../src/shared/process";

const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";

/** Percentiles por mes (1–12) con los años anteriores al último (mínimo 5 años). */
export function monthlyStats(pts: Pt[]) {
  const last = pts.length ? pts[pts.length - 1][0] : null;
  if (!last) return null;
  const cut = `${Number(last.slice(0, 4)) - 1}${last.slice(4)}`;
  const by: number[][] = Array.from({ length: 12 }, () => []);
  for (const [d, v] of pts) if (d <= cut) by[Number(d.slice(5, 7)) - 1].push(v);
  const q = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  const years = Math.min(...by.map((a) => a.length));
  if (years < 5) return null;
  return { years, p10: by.map((a) => q(a, 0.1)), p50: by.map((a) => q(a, 0.5)), p90: by.map((a) => q(a, 0.9)) };
}

export default async (req: Request) => {
  const id = decodeURIComponent(new URL(req.url).pathname.split("/").filter(Boolean).pop() || "");
  if (!/^[A-Z0-9]{1,12}:[A-Z]{2}:BOR$/.test(id)) return json({ error: "embalse inválido" }, 400, "no-store");
  const today = new Date().toISOString().slice(0, 10);
  const q = (dur: string) => get(`${AWDB}/data?stationTriplets=${encodeURIComponent(id)}&elements=RESC&duration=${dur}&beginDate=1991-01-01&endDate=${today}`, "json", 8000);
  const [meta, daily, monthly] = await Promise.all([
    get(`${AWDB}/stations?stationTriplets=${encodeURIComponent(id)}&returnReservoirMetadata=true`, "json", 6000),
    q("DAILY"),
    q("MONTHLY"),
  ]);
  const st = Array.isArray(meta) ? meta[0] : null;
  const d = Array.isArray(daily) ? parseAwdbValues(daily[0]?.data?.[0]?.values || []) : [];
  const m = Array.isArray(monthly) ? parseAwdbValues(monthly[0]?.data?.[0]?.values || []) : [];
  const twoYears = new Date(Date.now() - 730 * 86400e3).toISOString().slice(0, 10);
  const useDaily = d.filter(([x]) => x >= twoYears).length >= 60;
  if (!useDaily && !m.length) return json({ error: "NRCS no devolvió datos de almacenamiento para este embalse" }, 502, "public, s-maxage=300");
  const cap = Number(st?.reservoirMetadata?.usableCapacity) || Number(st?.reservoirMetadata?.capacity) || null;
  const body = useDaily
    ? { freq: "diario", summary: summarize(d, true), monthlyStats: null }
    : { freq: "mensual", summary: summarize(m, false), monthlyStats: monthlyStats(m) };
  return json(
    {
      id, name: st?.name ?? null, state: st?.stateCode ?? null, elevationFt: st?.elevation ?? null, lat: st?.latitude ?? null, lon: st?.longitude ?? null,
      capacity_af: cap && cap > 0 ? cap : null, ...body,
      links: { nrcs: `https://wcc.sc.egov.usda.gov/reportGenerator/view/customSingleStationReport/daily/${encodeURIComponent(id)}%7Cid=%22%22%7Cname/-30,0/RESC::value` },
    },
    200,
    "public, durable, s-maxage=21600, stale-while-revalidate=43200",
  );
};

export const config: Config = { path: "/api/nrcsres/*" };
