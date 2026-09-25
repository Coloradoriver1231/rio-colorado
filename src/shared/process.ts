/**
 * Procesamiento puro (sin red) compartido entre las funciones de Netlify y los tests.
 * Formato USBR hydrodata verificado: {"columns":["datetime","storage"],"data":[["1963-06-28",0.0],...]}
 */

export type Pt = [string, number]; // [YYYY-MM-DD, valor]

export interface DoyStats {
  years: number; // cantidad de años usados
  p10: (number | null)[]; // índice 0..364 (29-feb se une al 28-feb)
  p50: (number | null)[];
  p90: (number | null)[];
}

export interface SeriesSummary {
  first: string;
  last: Pt;
  recent: Pt[]; // últimos 730 días
  max: Pt;
  min: Pt;
  doy: DoyStats | null;
  monthly: Pt[] | null; // último valor de cada mes (historia completa), sólo almacenamiento y cota
}

/** Lee el JSON de hydrodata. Descarta filas sin fecha válida o sin número finito. */
export function parseHydrodata(j: unknown): Pt[] {
  const rows = (j as any)?.data;
  if (!Array.isArray(rows)) throw new Error("formato inesperado: falta 'data'");
  const out: Pt[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 2) continue;
    const d = typeof r[0] === "string" ? r[0].slice(0, 10) : "";
    const v = typeof r[1] === "number" ? r[1] : typeof r[1] === "string" && r[1].trim() !== "" ? Number(r[1]) : NaN;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(v)) continue;
    out.push([d, v]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  // fechas duplicadas: queda la última
  const dedup: Pt[] = [];
  for (const p of out) {
    if (dedup.length && dedup[dedup.length - 1][0] === p[0]) dedup[dedup.length - 1] = p;
    else dedup.push(p);
  }
  return dedup;
}

const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
/** Día del año 0..364 ignorando bisiestos (29-feb cuenta como 28-feb). */
export function doyIndex(date: string): number {
  const m = Number(date.slice(5, 7));
  let d = Number(date.slice(8, 10));
  if (m === 2 && d === 29) d = 28;
  return CUM[m - 1] + d - 1;
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(date + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Percentiles por día del año usando años ANTERIORES al último año móvil
 * (así el año actual no se compara consigo mismo). Se usa una ventana de ±3 días
 * para suavizar. Hace falta ≥5 años con dato en ese día; si no, null.
 */
export function doyStats(pts: Pt[], lastDate: string, minYears = 5): DoyStats | null {
  const cutoff = addDays(lastDate, -365);
  const buckets: Map<number, number>[] = Array.from({ length: 365 }, () => new Map()); // año -> valor
  for (const [d, v] of pts) {
    if (d > cutoff) break;
    buckets[doyIndex(d)].set(Number(d.slice(0, 4)), v);
  }
  const p10: (number | null)[] = [];
  const p50: (number | null)[] = [];
  const p90: (number | null)[] = [];
  let maxYears = 0;
  for (let i = 0; i < 365; i++) {
    const vals: number[] = [];
    for (let k = -3; k <= 3; k++) {
      const b = buckets[(i + k + 365) % 365];
      b.forEach((v) => vals.push(v));
    }
    const years = buckets[i].size;
    maxYears = Math.max(maxYears, years);
    if (years < minYears || vals.length === 0) {
      p10.push(null); p50.push(null); p90.push(null);
      continue;
    }
    vals.sort((a, b) => a - b);
    p10.push(round(quantile(vals, 0.1)));
    p50.push(round(quantile(vals, 0.5)));
    p90.push(round(quantile(vals, 0.9)));
  }
  if (maxYears < minYears) return null;
  return { years: maxYears, p10, p50, p90 };
}

function round(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
}

export function monthlyLast(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const ym = p[0].slice(0, 7);
    if (out.length && out[out.length - 1][0].slice(0, 7) === ym) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

export function summarize(pts: Pt[], withMonthly: boolean): SeriesSummary | null {
  if (!pts.length) return null;
  const last = pts[pts.length - 1];
  const from = addDays(last[0], -730);
  let max = pts[0];
  let min = pts[0];
  for (const p of pts) {
    if (p[1] > max[1]) max = p;
    if (p[1] < min[1]) min = p;
  }
  return {
    first: pts[0][0],
    last,
    recent: pts.filter((p) => p[0] >= from),
    max,
    min,
    doy: doyStats(pts, last[0]),
    monthly: withMonthly ? monthlyLast(pts) : null,
  };
}

/* ------------------------------ USGS ------------------------------ */

export interface GaugeOut {
  id: string;
  name: string; // nombre oficial USGS
  lat: number | null;
  lon: number | null;
  series: [number, number][]; // [epoch ms, cfs] horario
}

/**
 * Convierte la respuesta JSON de USGS Instantaneous Values (parámetro 00060, caudal cfs)
 * en series horarias compactas. Descarta el valor "sin dato" (noDataValue, típicamente -999999).
 */
export function parseUsgsIv(j: unknown): Record<string, GaugeOut> {
  const ts = (j as any)?.value?.timeSeries;
  if (!Array.isArray(ts)) throw new Error("formato USGS inesperado");
  const out: Record<string, GaugeOut> = {};
  for (const t of ts) {
    const id: string | undefined = t?.sourceInfo?.siteCode?.[0]?.value;
    if (!id) continue;
    const nodata = Number(t?.variable?.noDataValue ?? -999999);
    const geo = t?.sourceInfo?.geoLocation?.geogLocation;
    const hourly = new Map<number, number>();
    // varias series de valores (p.ej. distintos métodos): se usa la que más datos tiene
    const blocks: any[] = Array.isArray(t?.values) ? t.values : [];
    const best = blocks.reduce((a: any, b: any) => ((b?.value?.length || 0) > (a?.value?.length || 0) ? b : a), blocks[0]);
    for (const v of best?.value || []) {
      const val = Number(v?.value);
      const tms = Date.parse(v?.dateTime);
      if (!Number.isFinite(val) || !Number.isFinite(tms) || val === nodata || val < -1000) continue;
      hourly.set(Math.floor(tms / 3600000) * 3600000, val); // último valor de cada hora
    }
    const series = [...hourly.entries()].sort((a, b) => a[0] - b[0]);
    const prev = out[id];
    if (prev && prev.series.length >= series.length) continue;
    out[id] = {
      id,
      name: String(t?.sourceInfo?.siteName || id),
      lat: Number.isFinite(Number(geo?.latitude)) ? Number(geo.latitude) : null,
      lon: Number.isFinite(Number(geo?.longitude)) ? Number(geo.longitude) : null,
      series,
    };
  }
  return out;
}

/**
 * USGS Water Data API nueva (OGC, colección "continuous"): GeoJSON con properties.time (ISO) y properties.value.
 * Se usa como respaldo cuando waterservices falla. Devuelve la serie horaria (último valor de cada hora).
 */
export function parseUsgsOgcContinuous(j: unknown): [number, number][] {
  const feats: any[] = Array.isArray((j as any)?.features) ? (j as any).features : [];
  const hourly = new Map<number, [number, number]>();
  for (const f of feats) {
    const p = f?.properties || {};
    const t = Date.parse(p.time);
    const v = p.value === null || p.value === "" ? NaN : Number(p.value);
    if (!Number.isFinite(t) || !Number.isFinite(v) || v < -1000) continue;
    const h = Math.floor(t / 3600000) * 3600000;
    const prev = hourly.get(h);
    if (!prev || t >= prev[0]) hourly.set(h, [t, v]);
  }
  return [...hourly.entries()].sort((a, b) => a[0] - b[0]).map(([h, [, v]]) => [h, v]);
}
