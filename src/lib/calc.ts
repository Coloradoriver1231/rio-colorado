import type { Pt, SeriesSummary } from "../shared/process";
import { addDays, daysBetween, doyIndex } from "../shared/process";
import { AF_PER_DAY_TO_CFS, CFS_DAY_TO_AF } from "./units";

export interface ReservoirCat {
  site: number;
  name: string;
  dam?: string;
  river: string;
  state: string;
  sub: string;
  major?: boolean;
  capacity_af?: number;
  full_ft?: number;
  estimate_inflow?: boolean;
  levels_ft?: { ft: number; label: string }[];
}

export interface UsbrResponse {
  site: number;
  fetchedAt: string;
  series: { storage?: SeriesSummary | null; inflow?: SeriesSummary | null; release?: SeriesSummary | null; elevation?: SeriesSummary | null };
  errors: Record<string, string>;
}

export type Cls = "muy-bajo" | "bajo" | "normal" | "alto" | "muy-alto";
export const CLS_LABEL: Record<Cls, string> = {
  "muy-bajo": "Muy bajo",
  bajo: "Bajo",
  normal: "Normal",
  alto: "Alto",
  "muy-alto": "Muy alto",
};

export interface ResView {
  cat: ReservoirCat;
  data: UsbrResponse | null;
  state: "loading" | "ok" | "error" | "nodata";
  error?: string;
  lastDate: string | null;
  ageDays: number | null;
  stale: boolean;
  storage: number | null;
  pct: number | null;
  pctBasis: "capacity" | "record" | null;
  capSource: "usbr" | "nrcs" | null; // de dónde sale la capacidad
  refMax: number | null; // capacidad o máximo registrado usado para el %
  storageLastYear: number | null;
  pctLastYear: number | null;
  ch1: number | null;
  ch7: number | null;
  ch30: number | null;
  median: number | null;
  vsMedian: number | null;
  cls: Cls | null;
  statYears: number | null;
  elevation: number | null;
  elevationDate: string | null;
  elevCh7: number | null;
  inflowLast: number | null;
  releaseLast: number | null;
  inflow7: number | null;
  release7: number | null;
  inflowEstimated: boolean;
  net7: number | null;
  in30af: number | null;
  out30af: number | null;
  inflowSeries: Pt[]; // cfs diarios (estimada si inflowEstimated)
  releaseSeries: Pt[];
}

export const STALE_DAYS = 4;

export function todayISO(): string {
  // fecha local del navegador
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Valor en la fecha pedida o el más cercano anterior dentro de `tol` días. */
export function valueAt(pts: Pt[] | undefined, date: string, tol = 3): number | null {
  if (!pts || !pts.length) return null;
  let lo = 0;
  let hi = pts.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][0] <= date) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 0) return null;
  return daysBetween(pts[idx][0], date) <= tol ? pts[idx][1] : null;
}

/** Promedio de los valores con fecha en (end-n, end]. Exige al menos la mitad de los días. */
export function meanLast(pts: Pt[] | undefined, end: string, n: number): number | null {
  if (!pts) return null;
  const from = addDays(end, -n);
  const v = pts.filter((p) => p[0] > from && p[0] <= end).map((p) => p[1]);
  if (v.length < Math.ceil(n / 2)) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Volumen (acre-feet) de un caudal medio diario (cfs) sumado en (end-n, end]. Exige ≥80 % de los días. */
export function volumeLast(pts: Pt[] | undefined, end: string, n: number): number | null {
  if (!pts) return null;
  const from = addDays(end, -n);
  const v = pts.filter((p) => p[0] > from && p[0] <= end);
  if (v.length < Math.ceil(n * 0.8)) return null;
  // se escala a n días si falta alguno
  return (v.reduce((a, p) => a + p[1], 0) * CFS_DAY_TO_AF * n) / v.length;
}

/**
 * Entrada estimada por balance: salida + cambio de almacenamiento (sin evaporación ni filtraciones,
 * por eso subestima un poco). Media móvil de 7 días porque el dato diario es ruidoso.
 */
export function estimateInflow(storage: Pt[], release: Pt[]): Pt[] {
  const rel = new Map(release);
  const raw: Pt[] = [];
  for (let i = 1; i < storage.length; i++) {
    const [d, s] = storage[i];
    const [d0, s0] = storage[i - 1];
    if (daysBetween(d0, d) !== 1) continue;
    const r = rel.get(d);
    if (r == null) continue;
    raw.push([d, r + (s - s0) * AF_PER_DAY_TO_CFS]);
  }
  const out: Pt[] = [];
  for (let i = 0; i < raw.length; i++) {
    const from = addDays(raw[i][0], -7);
    const win = [];
    for (let k = i; k >= 0 && raw[k][0] > from; k--) win.push(raw[k][1]);
    if (win.length >= 5) out.push([raw[i][0], Math.max(0, win.reduce((a, b) => a + b, 0) / win.length)]);
  }
  return out;
}

export function classify(v: number, p10: number, p50: number, p90: number): Cls {
  if (v < p10) return "muy-bajo";
  if (v > p90) return "muy-alto";
  const band = (p90 - p10) * 0.15;
  if (v < p50 - band) return "bajo";
  if (v > p50 + band) return "alto";
  return "normal";
}

export function derive(cat: ReservoirCat, data: UsbrResponse | null, state: ResView["state"], error: string | undefined, today = todayISO(), nrcsCapacity: number | null = null): ResView {
  const s = data?.series || {};
  const st = s.storage || null;
  const el = s.elevation || null;
  const lastDate = st?.last[0] || el?.last[0] || null;
  const ageDays = lastDate ? daysBetween(lastDate, today) : null;
  const stale = ageDays != null && ageDays > STALE_DAYS;

  const storage = st ? st.last[1] : null;
  let refMax: number | null = null;
  let pctBasis: ResView["pctBasis"] = null;
  let capSource: ResView["capSource"] = null;
  if (cat.capacity_af) { refMax = cat.capacity_af; pctBasis = "capacity"; capSource = "usbr"; }
  else if (nrcsCapacity && nrcsCapacity > 0) { refMax = nrcsCapacity; pctBasis = "capacity"; capSource = "nrcs"; }
  else if (st && st.max[1] > 0) { refMax = st.max[1]; pctBasis = "record"; }
  const pct = storage != null && refMax ? storage / refMax : null;

  const d0 = st?.last[0];
  const storageLastYear = st && d0 ? valueAt(st.recent, addDays(d0, -365)) : null;
  const pctLastYear = storageLastYear != null && refMax ? storageLastYear / refMax : null;
  const diff = (n: number) => {
    if (!st || !d0) return null;
    const v = valueAt(st.recent, addDays(d0, -n), n === 1 ? 0 : 2);
    return v == null ? null : st.last[1] - v;
  };

  let median: number | null = null;
  let cls: Cls | null = null;
  if (st?.doy && d0) {
    const i = doyIndex(d0);
    const p10 = st.doy.p10[i], p50 = st.doy.p50[i], p90 = st.doy.p90[i];
    if (p10 != null && p50 != null && p90 != null) {
      median = p50;
      cls = classify(st.last[1], p10, p50, p90);
    }
  }

  const releaseSeries = s.release?.recent || [];
  let inflowSeries = s.inflow?.recent || [];
  let inflowEstimated = false;
  if (!inflowSeries.length && cat.estimate_inflow && st && releaseSeries.length) {
    inflowSeries = estimateInflow(st.recent, releaseSeries);
    inflowEstimated = true;
  }
  const endIn = inflowSeries.length ? inflowSeries[inflowSeries.length - 1][0] : null;
  const endOut = releaseSeries.length ? releaseSeries[releaseSeries.length - 1][0] : null;
  const inflow7 = endIn ? meanLast(inflowSeries, endIn, 7) : null;
  const release7 = endOut ? meanLast(releaseSeries, endOut, 7) : null;
  const elevD = el?.last[0];
  const elev7 = el && elevD ? valueAt(el.recent, addDays(elevD, -7), 2) : null;

  return {
    cat, data, state, error,
    lastDate, ageDays, stale,
    storage, pct, pctBasis, capSource, refMax, storageLastYear, pctLastYear,
    ch1: diff(1), ch7: diff(7), ch30: diff(30),
    median, vsMedian: median != null && storage != null ? storage - median : null, cls,
    statYears: st?.doy?.years ?? null,
    elevation: el ? el.last[1] : null,
    elevationDate: elevD || null,
    elevCh7: el && elev7 != null ? el.last[1] - elev7 : null,
    inflowLast: endIn ? inflowSeries[inflowSeries.length - 1][1] : null,
    releaseLast: endOut ? releaseSeries[releaseSeries.length - 1][1] : null,
    inflow7, release7, inflowEstimated,
    net7: inflow7 != null && release7 != null && endIn === endOut ? inflow7 - release7 : null,
    in30af: endIn ? volumeLast(inflowSeries, endIn, 30) : null,
    out30af: endOut ? volumeLast(releaseSeries, endOut, 30) : null,
    inflowSeries, releaseSeries,
  };
}

export interface SystemTotals {
  storage: number;
  capacity: number;
  pct: number;
  lastYear: number | null;
  pctLastYear: number | null;
  included: string[];
  missing: string[];
  date: string | null;
}

/** Total de los embalses con capacidad conocida (USBR o NRCS) y dato vigente. */
export function systemTotals(views: ResView[]): SystemTotals {
  const withCap = views.filter((v) => v.pctBasis === "capacity" && v.refMax);
  const ok = withCap.filter((v) => v.storage != null && !v.stale);
  const storage = ok.reduce((a, v) => a + (v.storage || 0), 0);
  const capacity = ok.reduce((a, v) => a + (v.refMax || 0), 0);
  const lyOk = ok.every((v) => v.storageLastYear != null);
  const lastYear = lyOk ? ok.reduce((a, v) => a + (v.storageLastYear || 0), 0) : null;
  const dates = ok.map((v) => v.lastDate!).sort();
  return {
    storage, capacity,
    pct: capacity ? storage / capacity : 0,
    lastYear,
    pctLastYear: lastYear != null && capacity ? lastYear / capacity : null,
    included: ok.map((v) => v.cat.name),
    missing: withCap.filter((v) => !ok.includes(v)).map((v) => v.cat.name),
    date: dates.length ? dates[0] : null,
  };
}

/* ------------------------------ NRCS (toda la cuenca) ------------------------------ */

export interface BasinRes {
  id: string;
  name: string;
  state: string;
  basin: "alta" | "baja";
  subbasin: string;
  lat: number;
  lon: number;
  capacity_af: number | null;
  hdb_site: number | null;
  freq: "diario" | "mensual" | null;
  date: string | null;
  af: number | null;
  ch7: number | null;
  ch30: number | null;
  last_year_af: number | null;
}

const normName = (s: string) => s.toLowerCase().replace(/\b(reservoir|lake|res)\b/g, "").replace(/[^a-z]/g, "");

/** Vincula cada embalse NRCS con el catálogo USBR: por sitio USBR (cercanía) o, si no, por nombre exacto normalizado. */
export function linkBasin(basin: BasinRes[], cats: ReservoirCat[]): { capBySite: Map<number, number>; others: BasinRes[] } {
  const bySite = new Map(cats.map((c) => [c.site, c]));
  const byName = new Map(cats.map((c) => [normName(c.name), c]));
  const capBySite = new Map<number, number>();
  const others: BasinRes[] = [];
  for (const b of basin) {
    const c = (b.hdb_site != null && bySite.get(b.hdb_site)) || byName.get(normName(b.name));
    if (c) { if (b.capacity_af && !capBySite.has(c.site)) capBySite.set(c.site, b.capacity_af); }
    else others.push(b);
  }
  return { capBySite, others };
}

/** Total de toda la cuenca = embalses USBR (con capacidad y dato vigente) + resto de NRCS con dato diario vigente. */
export function basinTotals(tot: SystemTotals, others: BasinRes[], today = todayISO()) {
  const ok = others.filter((b) => b.capacity_af && b.af != null && b.freq === "diario" && b.date && daysBetween(b.date, today) <= STALE_DAYS);
  const storage = tot.storage + ok.reduce((a, b) => a + (b.af || 0), 0);
  const capacity = tot.capacity + ok.reduce((a, b) => a + (b.capacity_af || 0), 0);
  const lyOk = tot.lastYear != null && ok.every((b) => b.last_year_af != null);
  const lastYear = lyOk ? tot.lastYear! + ok.reduce((a, b) => a + (b.last_year_af || 0), 0) : null;
  return {
    storage, capacity, pct: capacity ? storage / capacity : 0,
    lastYear, pctLastYear: lastYear != null && capacity ? lastYear / capacity : null,
    count: tot.included.length + ok.length,
  };
}
