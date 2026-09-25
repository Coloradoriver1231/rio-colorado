/**
 * Lo que VIENE (no medido):
 *  1) Pronóstico meteorológico 10 días (Open-Meteo, modelos globales; NO oficial) en estaciones SNOTEL altas.
 *  2) Perspectiva estacional oficial de NOAA CPC (3 meses): probabilidad de precipitación y temperatura
 *     por encima / normal / por debajo de lo normal. No da cantidades.
 */
import { get } from "./net";
import type { Station } from "./snow";

/* ------------------------------------------------------------------ puntos */
export interface Point { name: string; region: string; lat: number; lon: number; elevM: number | null }

/** Regiones fijas para la perspectiva CPC (centros aproximados de las zonas nevadas de cada parte de la cuenca). */
export const REGIONS: { id: string; name: string; lat: number; lon: number }[] = [
  { id: "headwaters", name: "Rocosas de Colorado (nacientes del Colorado)", lat: 39.6, lon: -106.3 },
  { id: "gunnison-sj", name: "Gunnison / San Juan (sudoeste de Colorado)", lat: 37.8, lon: -107.5 },
  { id: "upper-green", name: "Green alto (Wyoming)", lat: 42.5, lon: -110.0 },
  { id: "uintas", name: "Uintas y Wasatch (Utah)", lat: 40.6, lon: -110.6 },
  { id: "lower", name: "Montañas de Arizona (Salt / Verde / Gila)", lat: 34.2, lon: -111.3 },
];

/** Para el pronóstico de 10 días: hasta 3 SNOTEL más altas por subcuenca de la Cuenca Alta (se usa su altura real). */
export function pickPoints(stations: Station[] | null | undefined): Point[] {
  const up = (stations || []).filter((s) => s.basin === "alta" && s.elev != null);
  if (!up.length) return REGIONS.filter((r) => r.id !== "lower").map((r) => ({ name: r.name, region: r.name, lat: r.lat, lon: r.lon, elevM: null }));
  const by = new Map<string, Station[]>();
  for (const s of up) by.set(s.subbasin, [...(by.get(s.subbasin) || []), s]);
  const out: Point[] = [];
  for (const [sub, list] of by) {
    list.sort((a, b) => (b.elev || 0) - (a.elev || 0));
    for (const s of list.slice(0, 3)) out.push({ name: s.name, region: sub, lat: s.lat, lon: s.lon, elevM: Math.round((s.elev as number) * 0.3048) });
  }
  return out;
}

/* ------------------------------------------------------------------ 10 días */
export interface Weather10 {
  source: string; fetchedAt: string; days: string[];
  regions: { name: string; points: number; snowCm: (number | null)[]; precMm: (number | null)[]; tmin: (number | null)[]; tmax: (number | null)[]; totalSnowCm: number | null; totalPrecMm: number | null }[];
}

const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

export function aggregateWeather(points: Point[], raw: any): Weather10 | null {
  const list: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!list.length || !list[0]?.daily?.time) return null;
  const days: string[] = list[0].daily.time;
  const regions = [...new Set(points.map((p) => p.region))].map((name) => {
    const idx = points.map((p, i) => (p.region === name ? i : -1)).filter((i) => i >= 0 && list[i]?.daily);
    const col = (k: string) => days.map((_, d) => mean(idx.map((i) => list[i].daily[k]?.[d])));
    const snowCm = col("snowfall_sum"), precMm = col("precipitation_sum");
    const tot = (a: (number | null)[]) => (a.every((x) => x == null) ? null : a.reduce<number>((s, x) => s + (x ?? 0), 0));
    return { name, points: idx.length, snowCm, precMm, tmin: col("temperature_2m_min"), tmax: col("temperature_2m_max"), totalSnowCm: tot(snowCm), totalPrecMm: tot(precMm) };
  });
  return { source: "Open-Meteo (modelos meteorológicos globales, selección automática)", fetchedAt: new Date().toISOString(), days, regions };
}

export async function weather10(points: Point[]): Promise<Weather10 | null> {
  if (!points.length) return null;
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(","),
    longitude: points.map((p) => p.lon.toFixed(3)).join(","),
    daily: "snowfall_sum,precipitation_sum,temperature_2m_max,temperature_2m_min",
    timezone: "America/Denver",
    forecast_days: "10",
  });
  // la altura real de la estación corrige la temperatura (y por lo tanto si cae nieve o lluvia)
  if (points.every((p) => p.elevM != null)) params.set("elevation", points.map((p) => p.elevM).join(","));
  const raw = await get(`https://api.open-meteo.com/v1/forecast?${params}`, "json", 9000);
  return aggregateWeather(points, raw);
}

/* ------------------------------------------------------------------ CPC 3 meses */
type Ring = [number, number][];

/** Punto dentro de un polígono Esri (anillos exteriores y huecos; regla par-impar). */
export function inPolygon(lon: number, lat: number, rings: Ring[]): boolean {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  return inside;
}

/** CPC dibuja contornos 33, 40, 50, 60, 70, 80, 90 %: el polígono indica el límite inferior del rango. */
export function probRange(p: number): string {
  const steps = [33, 40, 50, 60, 70, 80, 90, 100];
  const i = steps.findIndex((s) => s > p);
  return i > 0 ? `${steps[i - 1]}–${steps[i]} %` : `${Math.round(p)} %`;
}

export interface CpcCell { cat: "Above" | "Below" | "Normal" | "EC" | string; prob: number | null; range: string | null }
export interface Cpc {
  fetchedAt: string; issued: string | null;
  leads: { lead: number; season: string | null; prcp: Record<string, CpcCell | null>; temp: Record<string, CpcCell | null> }[];
  error: string | null;
}

const CPC = "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks";

export function cellFor(features: any[], lon: number, lat: number): CpcCell | null {
  let best: CpcCell | null = null;
  for (const f of features || []) {
    const rings: Ring[] | undefined = f?.geometry?.rings;
    if (!rings || !inPolygon(lon, lat, rings)) continue;
    const a = f.attributes || {};
    const prob = Number.isFinite(a.prob) ? Number(a.prob) : null;
    const c: CpcCell = { cat: String(a.cat || ""), prob, range: prob != null && a.cat !== "EC" ? probRange(prob) : null };
    if (!best || (c.prob ?? 0) > (best.prob ?? 0)) best = c;
  }
  // fuera de todo polígono = "igual probabilidad" (CPC no dibuja nada)
  return best ?? { cat: "EC", prob: null, range: null };
}

export async function cpcOutlook(leads = [0, 1, 2, 3]): Promise<Cpc> {
  const q = (svc: string, layer: number) =>
    get(`${CPC}/${svc}/MapServer/${layer}/query?where=1%3D1&outFields=prob,cat,valid_seas,fcst_date&returnGeometry=true&outSR=4326&maxAllowableOffset=0.05&f=json`, "json", 9000);
  const res = await Promise.all(leads.flatMap((l) => [q("cpc_sea_precip_outlk", l), q("cpc_sea_temp_outlk", l)]));
  let issued: string | null = null, failed = 0;
  const out = leads.map((l, k) => {
    const P = res[2 * k], T = res[2 * k + 1];
    if (!P?.features) failed++;
    if (!T?.features) failed++;
    const any = (P?.features || T?.features || [])[0]?.attributes;
    if (!issued && Number.isFinite(any?.fcst_date)) issued = new Date(any.fcst_date).toISOString().slice(0, 10);
    const cells = (j: any) => Object.fromEntries(REGIONS.map((r) => [r.id, j?.features ? cellFor(j.features, r.lon, r.lat) : null]));
    return { lead: l + 1, season: any?.valid_seas ? String(any.valid_seas) : null, prcp: cells(P), temp: cells(T) };
  });
  return { fetchedAt: new Date().toISOString(), issued, leads: out, error: failed === res.length ? "NOAA CPC no respondió" : failed ? `${failed} consultas a CPC fallaron` : null };
}
