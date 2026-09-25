/**
 * Nieve, precipitación y estimación del aporte de primavera-verano (cuenca del Colorado).
 *
 * Fuentes (todas oficiales):
 *  - NRCS AWDB, red SNOTEL: WTEQ = equivalente en agua de la nieve (SWE, pulgadas), PREC = precipitación
 *    acumulada del año hidrológico (pulgadas, incluye lluvia y nieve fundida en el pluviómetro), SNWD = altura de nieve.
 *    AWDB devuelve para cada día la MEDIANA y el PROMEDIO 1991–2020 de ese mismo día (normales oficiales NRCS).
 *  - NRCS AWDB /forecasts: pronóstico oficial de escurrimiento (NRCS + CBRFC) — Lake Powell Inflow, abril–julio.
 *  - USBR HDB sitio 919, datatype 34: volumen diario de entrada NO regulada a Lake Powell (acre-feet).
 *
 * Año hidrológico (water year) de EE.UU.: 1-oct → 30-sep, nombrado por el año en que termina (WY2026 = oct-2025 a sep-2026).
 * Las fechas de NRCS y USBR son fechas locales de la estación ("YYYY-MM-DD"); se tratan como texto, sin zonas horarias.
 */
import { get } from "./net";
import { analogPredict, fit, looPredictions, pearson, predict, quantile, skill, type Skill } from "./stats";
import { HUC4 } from "./hydro";

const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";
const HDB = "https://www.usbr.gov/uc/water/hydrodata/reservoir_data";
export const POWELL_FORECAST_POINT = "09379900:AZ:USGS"; // "Lake Powell Inflow" (NRCS/CBRFC)
const DAY = 86400e3;

/* ----------------------------------------------------------- fechas */
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => isoDay(Date.parse(d + "T00:00:00Z") + n * DAY);
/** Año hidrológico al que pertenece la fecha (nombrado por el año en que termina). */
export const waterYear = (d: string) => Number(d.slice(0, 4)) + (Number(d.slice(5, 7)) >= 10 ? 1 : 0);
export const wyStartOf = (wy: number) => `${wy - 1}-10-01`;

/* ----------------------------------------------------------- AWDB */
export interface Station { id: string; name: string; elev: number | null; lat: number; lon: number; huc4: string; subbasin: string; basin: "alta" | "baja" }
export interface Val { date: string; value: number; median?: number; average?: number }
export type ByElem = Record<string, Val[]>;

export async function listSnotel(ms = 9000): Promise<Station[] | null> {
  const j = await get(`${AWDB}/stations?stationTriplets=*:*:SNTL&hucs=14*,15*&elements=WTEQ&activeOnly=true`, "json", ms);
  if (!Array.isArray(j)) return null;
  const seen = new Set<string>();
  const out: Station[] = [];
  for (const s of j) {
    const id = String(s?.stationTriplet || "");
    const huc = String(s?.huc || "");
    if (!id || seen.has(id) || !/^1[45]/.test(huc) || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
    seen.add(id);
    out.push({
      id, name: String(s.name || id), elev: Number.isFinite(s.elevation) ? Number(s.elevation) : null,
      lat: Number(s.latitude), lon: Number(s.longitude), huc4: huc.slice(0, 4), subbasin: HUC4[huc.slice(0, 4)] || huc.slice(0, 4),
      basin: huc.startsWith("14") ? "alta" : "baja",
    });
  }
  return out;
}

export function parseAwdbData(arr: any): Map<string, ByElem> {
  const out = new Map<string, ByElem>();
  if (!Array.isArray(arr)) return out;
  for (const st of arr) {
    const id = String(st?.stationTriplet || "");
    if (!id) continue;
    const rec: ByElem = out.get(id) || {};
    for (const d of st?.data || []) {
      const el = String(d?.stationElement?.elementCode || "");
      if (!el) continue;
      const vals: Val[] = [];
      for (const x of d.values || []) {
        if (typeof x?.date !== "string" || typeof x.value !== "number" || !Number.isFinite(x.value)) continue;
        const v: Val = { date: x.date.slice(0, 10), value: x.value };
        if (typeof x.median === "number" && Number.isFinite(x.median)) v.median = x.median;
        if (typeof x.average === "number" && Number.isFinite(x.average)) v.average = x.average;
        vals.push(v);
      }
      vals.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      rec[el] = vals;
    }
    out.set(id, rec);
  }
  return out;
}

/** Datos diarios de muchas estaciones, en tandas de `chunk` (en paralelo, `par` a la vez). */
/**
 * Datos diarios de muchas estaciones, en tandas de `chunk` (de a `par` en paralelo).
 * Si una tanda falla (timeout o error), se parte en dos y se reintenta mientras quede tiempo (`budgetMs`);
 * una estación que falla sola dos veces queda como "error de consulta" (nunca como cero).
 */
export async function awdbDaily(ids: string[], elements: string, begin: string, end: string, central: boolean, chunk = 25, par = 8, ms = 9000, budgetMs = ms * 2) {
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  const queue: { ids: string[]; tries: number }[] = [];
  for (let i = 0; i < ids.length; i += chunk) queue.push({ ids: ids.slice(i, i + chunk), tries: 0 });
  const chunks = queue.length;
  const out = new Map<string, ByElem>();
  let failed = 0;
  const failedIds: string[] = [];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const timeout = Math.min(ms, left() - 200);
      let j: any = null;
      if (timeout >= 1000)
        j = await get(
          `${AWDB}/data?stationTriplets=${encodeURIComponent(c.ids.join(","))}&elements=${elements}&duration=DAILY&beginDate=${begin}&endDate=${end}` +
            (central ? "&centralTendencyType=ALL" : ""),
          "json", timeout,
        );
      if (Array.isArray(j)) {
        for (const [k, v] of parseAwdbData(j)) out.set(k, { ...(out.get(k) || {}), ...v });
        continue;
      }
      if (left() > 1500 && (c.ids.length > 1 || c.tries < 1)) {
        await new Promise((ok) => setTimeout(ok, 300)); // pausa corta por si AWDB está limitando pedidos
        if (c.ids.length > 1) {
          const h = Math.ceil(c.ids.length / 2);
          queue.push({ ids: c.ids.slice(0, h), tries: c.tries + 1 }, { ids: c.ids.slice(h), tries: c.tries + 1 });
        } else queue.push({ ids: c.ids, tries: c.tries + 1 });
        continue;
      }
      failed++;
      failedIds.push(...c.ids);
    }
  };
  await Promise.all(Array.from({ length: par }, worker));
  return { data: out, failedChunks: failed, chunks, failedIds };
}

/* ----------------------------------------------------------- precipitación de ventanas */
/**
 * PREC es acumulada desde el 1-oct y vuelve a cero al empezar cada año hidrológico.
 * Precipitación entre a (exclusive) y b (inclusive): si ambas fechas están en el mismo WY, PREC(b) − PREC(a);
 * si la ventana cruza el 1-oct: [PREC(30-sep) − PREC(a)] + PREC(b).
 * `pick` elige el campo (valor observado, o el promedio 1991–2020 del día para obtener la "normal" de la ventana:
 * como el promedio es lineal, promedio(b) − promedio(a) = promedio de la precipitación de la ventana).
 * La MEDIANA no es lineal: no se usa para ventanas (sólo para el acumulado del año).
 */
export function windowPrecip(series: Val[] | undefined, a: string, b: string, pick: (v: Val) => number | undefined): number | null {
  if (!series?.length) return null;
  const at = (d: string) => { const v = series.find((x) => x.date === d); return v ? pick(v) ?? null : null; };
  const vb = at(b), va = at(a);
  if (vb == null || va == null) return null;
  if (waterYear(a) === waterYear(b)) return Math.max(0, vb - va);
  const endPrev = at(`${waterYear(a)}-09-30`);
  if (endPrev == null) return null;
  return Math.max(0, endPrev - va) + Math.max(0, vb);
}

/* ----------------------------------------------------------- estado actual */
export interface StationNow {
  id: string; name: string; elev: number | null; lat: number; lon: number; subbasin: string; basin: "alta" | "baja"; date: string;
  swe: number | null; sweMed: number | null; snwd: number | null;
  prec: number | null; precMed: number | null;
  p7: number | null; p7avg: number | null; p30: number | null; p30avg: number | null;
  /** temperatura media del aire de los últimos 7 días (°F), su promedio histórico para esas fechas, y días con máxima > 0 °C */
  t7: number | null; t7avg: number | null; warmDays: number | null; tDays: number;
}
export interface Agg { t7: number | null; t7avg: number | null; nT: number; warmShare: number | null; n: number; stations: number; swe: number | null; sweMed: number | null; swePct: number | null; prec: number | null; precMed: number | null; precPct: number | null;
  p7: number | null; p7avg: number | null; p7Pct: number | null; n7: number; p30: number | null; p30avg: number | null; p30Pct: number | null; n30: number }

/** "% de la mediana" sólo cuando la mediana de la cuenca es significativa (≥ 1 pulgada de SWE o precipitación). */
const MIN_MED = 1.0;

export function aggregate(list: StationNow[], total: number): Agg {
  const both = (f: (s: StationNow) => [number | null, number | null]) => {
    const ok = list.map(f).filter(([v, m]) => v != null && m != null) as [number, number][];
    const n = ok.length;
    if (!n) return { v: null, m: null, pct: null, n };
    const sv = ok.reduce((a, [v]) => a + v, 0), sm = ok.reduce((a, [, m]) => a + m, 0);
    return { v: sv / n, m: sm / n, pct: sm / n >= MIN_MED ? sv / sm : null, n };
  };
  const s = both((x) => [x.swe, x.sweMed]);
  const tt = list.filter((x) => x.t7 != null);
  const tta = tt.filter((x) => x.t7avg != null);
  const wd = list.filter((x) => x.warmDays != null && x.tDays > 0);
  const p = both((x) => [x.prec, x.precMed]);
  const w7 = both((x) => [x.p7, x.p7avg]);
  const w30 = both((x) => [x.p30, x.p30avg]);
  return {
    t7: tt.length ? tt.reduce((a, x) => a + x.t7!, 0) / tt.length : null,
    // normal sólo sobre las mismas estaciones que tienen promedio histórico (si no son todas, se compara con ese subconjunto)
    t7avg: tta.length && tta.length === tt.length ? tta.reduce((a, x) => a + x.t7avg!, 0) / tta.length : null,
    nT: tt.length,
    warmShare: wd.length ? wd.reduce((a, x) => a + x.warmDays! / x.tDays, 0) / wd.length : null,
    n: s.n, stations: total, swe: s.v, sweMed: s.m, swePct: s.pct, prec: p.v, precMed: p.m, precPct: p.pct,
    // en ventanas cortas la normal puede ser muy chica: % sólo si el promedio de la ventana es ≥ 0,2 pulgadas
    p7: w7.v, p7avg: w7.m, p7Pct: w7.m != null && w7.m >= 0.2 && w7.v != null ? w7.v / w7.m : null, n7: w7.n,
    p30: w30.v, p30avg: w30.m, p30Pct: w30.m != null && w30.m >= 0.2 && w30.v != null ? w30.v / w30.m : null, n30: w30.n,
  };
}

/** Versión del formato guardado en Blobs: si cambia, lo guardado antes se descarta y se recalcula. */
export const STATUS_V = 4;
export const MODEL_V = 2;

export interface SnowStatus {
  v: number;
  builtAt: string; today: string; wy: number; wyStart: string;
  stations: StationNow[]; missing: number; failedChunks: number;
  /** cobertura por cuenca: esperadas (activas en NRCS), con dato vigente (≤ 3 días), desactualizadas, sin observación en el período, error de consulta */
  coverage: Record<"alta" | "baja", { expected: number; withData: number; stale: number; noObs: number; error: number }>;
  /** todas las estaciones esperadas con su estado (para la lista y el mapa) */
  roster: { id: string; name: string; elev: number | null; lat: number; lon: number; subbasin: string; basin: "alta" | "baja"; state: "ok" | "stale" | "noObs" | "error"; last: string | null }[];
  /** fecha más reciente con dato (fecha local de las estaciones) */
  dataDate: string | null;
  /** lista completa de SNOTEL (se guarda para no volver a pedirla) */
  allStations?: Station[];
  basins: Record<"alta" | "baja", Agg>;
  subbasins: (Agg & { name: string; basin: "alta" | "baja" })[];
  /** serie diaria de la temporada: promedio de las estaciones con dato y mediana ese día (mismo conjunto) */
  season: Record<"alta" | "baja", { dates: string[]; swe: (number | null)[]; sweMed: (number | null)[]; prec: (number | null)[]; precMed: (number | null)[]; n: number[] }>;
  forecasts: { publicationDate: string; issueDate: string | null; period: [string, string]; normal: number | null; unit: string; values: Record<string, number> }[];
  forecastError: string | null;
  /** versión liviana (últimos 32 días): sin gráfico de temporada completo */
  light: boolean;
  ms: number;
}

/**
 * `light`: sólo los últimos 32 días (rápido, para responder en ≤ 10 s si todavía no corrió la actualización programada).
 * La versión completa (desde 31 días antes del 1-oct) la arma la función programada, que tiene 30 s.
 */
export async function buildStatus(now = Date.now(), light = false, known?: Station[] | null): Promise<SnowStatus | null> {
  const t0 = Date.now();
  const found = known?.length ? known : await listSnotel(light ? 3500 : 9000);
  if (!found?.length) return null;
  const stations: Station[] = found;
  const today = isoDay(now);
  const wy = waterYear(today);
  const start = light ? addDays(today, -32) : addDays(wyStartOf(wy), -31); // un mes antes, para ventanas que cruzan el 1-oct
  const ids = stations.map((s) => s.id);
  const [main, depth, fc] = await Promise.all([
    awdbDaily(ids, "WTEQ,PREC", start, today, true, light ? 15 : 20, light ? 8 : 6, light ? 4500 : 12000, light ? 7500 : 24000),
    // altura de nieve y temperatura del aire (últimos 8 días); la temperatura trae el promedio 1991–2020 del día
    awdbDaily(ids, "SNWD,TAVG,TMAX", addDays(today, -8), today, true, 50, 4, light ? 4500 : 9000, light ? 6000 : 15000),
    get(`${AWDB}/forecasts?stationTriplets=${POWELL_FORECAST_POINT}&beginPublicationDate=${wyStartOf(wy)}&endPublicationDate=${today}`, "json", light ? 5000 : 9000),
  ]);

  const list: StationNow[] = [];
  let missing = 0;
  const failedSet = new Set(main.failedIds);
  const coverage = { alta: { expected: 0, withData: 0, stale: 0, noObs: 0, error: 0 }, baja: { expected: 0, withData: 0, stale: 0, noObs: 0, error: 0 } };
  const roster: SnowStatus["roster"] = [];
  for (const s of stations) {
    const cv = coverage[s.basin];
    cv.expected++;
    const base = { id: s.id, name: s.name, elev: s.elev, lat: s.lat, lon: s.lon, subbasin: s.subbasin, basin: s.basin };
    if (failedSet.has(s.id)) { cv.error++; missing++; roster.push({ ...base, state: "error", last: null }); continue; }
    const d = main.data.get(s.id);
    const w = d?.WTEQ || [], p = d?.PREC || [];
    const lastW = w.length ? w[w.length - 1] : null, lastP = p.length ? p[p.length - 1] : null;
    const date = [lastW?.date, lastP?.date].filter(Boolean).sort().pop() || null;
    // dato vigente: de los últimos 3 días. Una estación sin dato NO se toma como cero: queda fuera del promedio.
    if (!date) { cv.noObs++; missing++; roster.push({ ...base, state: "noObs", last: null }); continue; }
    if (date < addDays(today, -3)) { cv.stale++; missing++; roster.push({ ...base, state: "stale", last: date }); continue; }
    cv.withData++;
    roster.push({ ...base, state: "ok", last: date });
    const wv = lastW && lastW.date === date ? lastW : null;
    const pv = lastP && lastP.date === date ? lastP : null;
    const dd = depth.data.get(s.id);
    const sd = dd?.SNWD || [];
    const from7 = addDays(date, -7);
    const ta = (dd?.TAVG || []).filter((x) => x.date > from7 && x.date <= date);
    const tx = (dd?.TMAX || []).filter((x) => x.date > from7 && x.date <= date);
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const taAvg = ta.filter((x) => x.average != null);
    const sdv = sd.find((x) => x.date === date);
    list.push({
      id: s.id, name: s.name, elev: s.elev, lat: s.lat, lon: s.lon, subbasin: s.subbasin, basin: s.basin, date,
      swe: wv ? wv.value : null, sweMed: wv?.median ?? null, snwd: sdv ? sdv.value : null,
      prec: pv ? pv.value : null, precMed: pv?.median ?? null,
      p7: windowPrecip(p, addDays(date, -7), date, (v) => v.value), p7avg: windowPrecip(p, addDays(date, -7), date, (v) => v.average),
      p30: windowPrecip(p, addDays(date, -30), date, (v) => v.value), p30avg: windowPrecip(p, addDays(date, -30), date, (v) => v.average),
      // sólo con ≥ 5 de 7 días de dato
      t7: ta.length >= 5 ? mean(ta.map((x) => x.value)) : null,
      t7avg: taAvg.length >= 5 ? mean(taAvg.map((x) => x.average!)) : null,
      warmDays: tx.length >= 5 ? tx.filter((x) => x.value > 32).length : null, tDays: tx.length,
    });
  }

  const basins = {
    alta: aggregate(list.filter((s) => s.basin === "alta"), stations.filter((s) => s.basin === "alta").length),
    baja: aggregate(list.filter((s) => s.basin === "baja"), stations.filter((s) => s.basin === "baja").length),
  };
  const subNames = [...new Set(stations.map((s) => `${s.basin}|${s.subbasin}`))].sort();
  const subbasins = subNames.map((k) => {
    const [basin, name] = k.split("|") as ["alta" | "baja", string];
    return { name, basin, ...aggregate(list.filter((s) => s.subbasin === name && s.basin === basin), stations.filter((s) => s.subbasin === name && s.basin === basin).length) };
  });

  const season = { alta: seasonSeries("alta"), baja: seasonSeries("baja") };
  function seasonSeries(b: "alta" | "baja") {
    const dates: string[] = [], swe: (number | null)[] = [], sweMed: (number | null)[] = [], prec: (number | null)[] = [], precMed: (number | null)[] = [], n: number[] = [];
    const ids = stations.filter((s) => s.basin === b).map((s) => s.id);
    const idx = ids.map((id) => {
      const d = main.data.get(id);
      return { w: new Map((d?.WTEQ || []).map((v) => [v.date, v])), p: new Map((d?.PREC || []).map((v) => [v.date, v])) };
    });
    for (let d = light ? addDays(today, -32) : wyStartOf(wy); d <= today; d = addDays(d, 1)) {
      let sw = 0, sm = 0, nw = 0, pw = 0, pm = 0, np = 0;
      for (const x of idx) {
        const w = x.w.get(d);
        if (w && w.median != null) { sw += w.value; sm += w.median; nw++; }
        const p = x.p.get(d);
        if (p && p.median != null) { pw += p.value; pm += p.median; np++; }
      }
      dates.push(d);
      swe.push(nw ? sw / nw : null); sweMed.push(nw ? sm / nw : null);
      prec.push(np ? pw / np : null); precMed.push(np ? pm / np : null);
      n.push(nw);
    }
    return { dates, swe, sweMed, prec, precMed, n };
  }

  const forecasts = Array.isArray(fc)
    ? fc
        .flatMap((r: any) => (Array.isArray(r?.data) ? r.data : [r])) // la API devuelve registros sueltos o agrupados por estación
        .filter((r: any) => r && r.elementCode === "SRVO" && r.forecastValues && Array.isArray(r.forecastPeriod))
        .map((r: any) => ({
          publicationDate: String(r.publicationDate).slice(0, 10),
          issueDate: r.issueDate ? String(r.issueDate) : null,
          period: [String(r.forecastPeriod[0]), String(r.forecastPeriod[1])] as [string, string],
          normal: Number.isFinite(r.periodNormal) ? Number(r.periodNormal) : null,
          unit: String(r.unitCode || ""),
          values: Object.fromEntries(Object.entries(r.forecastValues).filter(([, v]) => Number.isFinite(v as number))) as Record<string, number>,
        }))
        .sort((a: any, b: any) => (a.publicationDate < b.publicationDate ? -1 : 1))
    : [];

  return {
    v: STATUS_V, builtAt: new Date(now).toISOString(), today, wy, wyStart: wyStartOf(wy), light, ms: Date.now() - t0,
    stations: list, missing, failedChunks: main.failedChunks, allStations: stations, coverage, roster,
    dataDate: list.length ? list.map((x) => x.date).sort().pop()! : null,
    basins, subbasins, season, forecasts,
    forecastError: Array.isArray(fc) ? null : "NRCS no devolvió pronósticos",
  };
}

/* ----------------------------------------------------------- aporte abril–julio observado (Powell) */
/** Volumen abril–julio de entrada no regulada a Lake Powell (acre-feet) por año; sólo años con ≥ 118 de 122 días. */
export function aprJul(csv: string): Map<number, number> {
  const by = new Map<number, { s: number; n: number }>();
  const lines = csv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].indexOf(",");
    if (c < 0) continue;
    const d = lines[i].slice(0, 10), v = Number(lines[i].slice(c + 1));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(v)) continue;
    const m = d.slice(5, 7);
    if (m < "04" || m > "07") continue;
    const y = Number(d.slice(0, 4));
    const r = by.get(y) || { s: 0, n: 0 };
    r.s += v; r.n++;
    by.set(y, r);
  }
  const out = new Map<number, number>();
  for (const [y, r] of by) if (r.n >= 118) out.set(y, r.s);
  return out;
}

/** Parcial del año en curso (abril→hoy) para mostrar "observado hasta ahora". */
export function aprJulSoFar(csv: string, year: number): { af: number; days: number; last: string } | null {
  let s = 0, n = 0, last = "";
  for (const line of csv.split(/\r?\n/)) {
    const d = line.slice(0, 10);
    if (!d.startsWith(`${year}-`)) continue;
    const m = d.slice(5, 7);
    if (m < "04" || m > "07") continue;
    const v = Number(line.slice(line.indexOf(",") + 1));
    if (!Number.isFinite(v)) continue;
    s += v; n++; last = d;
  }
  return n ? { af: s, days: n, last } : null;
}

/* ----------------------------------------------------------- estimación del monitor */
export interface Method {
  name: string; kind: "regresión" | "años análogos"; predictors: string[];
  r: number | null; r2: number | null; looR2: number | null; skill: Skill | null;
}
export interface ModelOut {
  v: number;
  builtAt: string; today: string; wy: number; runoffYear: number;
  /** fecha del calendario ("MM-DD") en la que se comparan todos los años */
  md: string; inSeason: boolean; reason: string | null;
  years: { wy: number; sweIdx: number | null; precIdx: number | null; prevRunoff: number | null; runoff: number | null }[];
  stationsUsed: number; stationsNow: number;
  current: { sweIdx: number | null; precIdx: number | null; prevRunoff: number | null };
  models: Method[];
  chosen: string | null;
  /** validación retrospectiva del método elegido: lo que habría estimado cada año sin conocer ese año */
  retro: { wy: number; actual: number; pred: number | null }[];
  halfWidth: number | null;
  analogYears: number[] | null;
  estimate: { low: number; central: number; high: number } | null;
  climatology: { from: number; to: number; median: number | null; mean: number | null; p10: number | null; p90: number | null; min: { wy: number; af: number } | null; max: { wy: number; af: number } | null; n: number };
  observedSoFar: { af: number; days: number; last: string } | null;
  confidence: { level: "alta" | "media" | "baja" | "insuficiente"; score: number | null; reasons: string[] };
}

const Z80 = 1.2816; // cuantil 90 % de la normal: rango 10 %–90 %

/**
 * Método (reproducible):
 *  1. Fecha de comparación: hoy (MM-DD) si estamos entre el 1-oct y el 1-abr; si no, el 1-abr (sólo como referencia).
 *  2. Para cada año hidrológico 1991→último completo, SWE y PREC de cada SNOTEL de la Cuenca Alta en esa fecha.
 *  3. Índice por año = promedio entre estaciones de (valor del año / promedio de esa estación en esa fecha).
 *     Sólo estaciones con dato en ≥ 80 % de los años y promedio ≥ 0,5". Así una estación que falta un año no sesga.
 *  4. y = volumen abril–julio de entrada no regulada a Lake Powell (USBR) del mismo año hidrológico.
 *  5. Tres regresiones lineales: y ~ SWE, y ~ PREC, y ~ SWE + PREC. Se elige la de menor error dejando un año afuera.
 *  6. Rango: estimación ± 1,2816 × error de validación cruzada (≈ 10 %–90 %), sin valores negativos.
 */
export async function buildModel(now = Date.now()): Promise<ModelOut | null> {
  const stationsAll = await listSnotel();
  if (!stationsAll?.length) return null;
  const st = stationsAll.filter((s) => s.basin === "alta");
  const today = isoDay(now);
  const wy = waterYear(today);
  const mdToday = today.slice(5, 10) === "02-29" ? "02-28" : today.slice(5, 10);
  const inSeason = mdToday >= "10-01" || mdToday <= "04-01";
  const md = inSeason ? mdToday : "04-01";
  const dateFor = (y: number) => `${Number(md.slice(0, 2)) >= 10 ? y - 1 : y}-${md}`;
  const FIRST = 1991;
  // años con abril–julio completo: si estamos en temporada, hasta el anterior; si no, el actual sólo desde agosto
  const lastComplete = inSeason ? wy - 1 : mdToday >= "08-01" ? wy : wy - 1;
  const histYears: number[] = [];
  for (let y = FIRST; y <= lastComplete; y++) histYears.push(y);

  const ids = st.map((s) => s.id);
  // pedidos de a 6 a la vez para no saturar AWDB (un pedido por año, con todas las estaciones)
  type R = Awaited<ReturnType<typeof awdbDaily>>;
  const tasks: (() => Promise<R>)[] = histYears.map((y) => () => awdbDaily(ids, "WTEQ,PREC", dateFor(y), dateFor(y), false, 100, 1, 12000));
  if (inSeason) tasks.push(() => awdbDaily(ids, "WTEQ,PREC", addDays(today, -2), today, false, 100, 1, 12000));
  const results: R[] = new Array(tasks.length);
  let next = 0;
  const csvP = get(`${HDB}/919/csv/34.csv`, "text", 12000);
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let i = next++; i < tasks.length; i = next++) results[i] = await tasks[i]();
  }));
  const csv = await csvP;
  const perYear = results.slice(0, histYears.length);
  const curData = inSeason ? results[histYears.length] : null;
  const runoff = csv ? aprJul(csv as string) : new Map<number, number>();

  const val = (m: Map<string, ByElem> | undefined, id: string, el: string, date?: string) => {
    const s = m?.get(id)?.[el];
    if (!s?.length) return null;
    const v = date ? s.find((x) => x.date === date) : s[s.length - 1];
    return v ? v.value : null;
  };
  // matriz estación × año
  const W = st.map((s) => histYears.map((y, i) => val(perYear[i]?.data, s.id, "WTEQ", dateFor(y))));
  const P = st.map((s) => histYears.map((y, i) => val(perYear[i]?.data, s.id, "PREC", dateFor(y))));
  const idx = (M: (number | null)[][], cur: (number | null)[]) => {
    const use = M.map((row) => {
      const ok = row.filter((v): v is number => v != null);
      const mean = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0;
      return ok.length >= 0.8 * histYears.length && mean >= 0.5 ? mean : null;
    });
    const years = histYears.map((_, j) => {
      const r = M.map((row, s) => (use[s] != null && row[j] != null ? row[j]! / use[s]! : null)).filter((v): v is number => v != null);
      return r.length >= 5 ? r.reduce((a, b) => a + b, 0) / r.length : null;
    });
    const curR = cur.map((v, s) => (use[s] != null && v != null ? v / use[s]! : null)).filter((v): v is number => v != null);
    return { years, current: curR.length >= 5 ? curR.reduce((a, b) => a + b, 0) / curR.length : null, used: use.filter((u) => u != null).length, now: curR.length };
  };
  const curW = st.map((s) => val(curData?.data, s.id, "WTEQ"));
  const curP = st.map((s) => val(curData?.data, s.id, "PREC"));
  const sw = idx(W, curW), pr = idx(P, curP);

  const years = histYears.map((y, j) => ({ wy: y, sweIdx: sw.years[j], precIdx: pr.years[j], prevRunoff: runoff.get(y - 1) ?? null, runoff: runoff.get(y) ?? null }));
  const current = { sweIdx: sw.current, precIdx: pr.current, prevRunoff: runoff.get(wy - 1) ?? null };
  type P = "sweIdx" | "precIdx" | "prevRunoff";
  const rowsFor = (preds: P[]) => years.filter((r) => r.runoff != null && preds.every((p) => r[p] != null));
  const sstOf = (y: number[]) => { const m = y.reduce((a, b) => a + b, 0) / y.length; return y.reduce((a, v) => a + (v - m) ** 2, 0); };

  // regresiones (validación: cada año predicho con un ajuste que no lo incluye)
  const reg = (name: string, preds: P[]) => {
    const ok = rowsFor(preds);
    const X = ok.map((r) => preds.map((p) => r[p] as number)), y = ok.map((r) => r.runoff as number);
    const f = fit(X, y, preds);
    const loo = f ? looPredictions(X, y) : [];
    return {
      m: { name, kind: "regresión" as const, predictors: preds, r: preds.length === 1 && ok.length > 2 ? pearson(X.map((x) => x[0]), y) : null,
        r2: f?.r2 ?? null, looR2: f?.looR2 ?? null, skill: f ? skill(y, loo, null) : null },
      rows: ok, loo, predictNow: (x: number[]) => (f ? predict(f.coef, x) : null),
    };
  };
  // años análogos (k = 5) sobre SWE y precipitación
  const analog = () => {
    const preds: P[] = ["sweIdx", "precIdx"];
    const ok = rowsFor(preds);
    const X = ok.map((r) => preds.map((p) => r[p] as number)), y = ok.map((r) => r.runoff as number);
    const loo = ok.map((_, i) => analogPredict(X.filter((_, k) => k !== i), y.filter((_, k) => k !== i), X[i])?.pred ?? null);
    const sk = ok.length >= 15 ? skill(y, loo, null) : null;
    const sst = ok.length ? sstOf(y) : 0;
    return {
      m: { name: "Años análogos (5 más parecidos en SWE y precipitación)", kind: "años análogos" as const, predictors: preds, r: null, r2: null,
        looR2: sk && sst > 0 ? 1 - (sk.rmse ** 2 * sk.n) / sst : null, skill: sk },
      rows: ok, loo, predictNow: (x: number[]) => analogPredict(X, y, x)?.pred ?? null,
      analogYearsNow: (x: number[]) => analogPredict(X, y, x)?.years.map((i) => ok[i].wy) ?? null,
    };
  };
  const cands = [
    reg("SWE", ["sweIdx"]),
    reg("Precipitación acumulada", ["precIdx"]),
    reg("SWE + precipitación", ["sweIdx", "precIdx"]),
    reg("SWE + aporte del año anterior (humedad de la cuenca, aproximada)", ["sweIdx", "prevRunoff"]),
  ];
  const an = analog();
  const all = [...cands, an];
  const usable = all.filter((c) => c.m.skill && c.m.skill.n >= 15).sort((a, b) => a.m.skill!.rmse - b.m.skill!.rmse);
  const best = usable[0] || null;
  const halfWidth = best ? Z80 * best.m.skill!.rmse : null;
  // cobertura del intervalo en la validación del método elegido
  if (best) best.m.skill = skill(best.rows.map((r) => r.runoff as number), best.loo, halfWidth);
  const models: Method[] = all.map((c) => c.m);
  const chosen = best ? { name: best.m.name, predictors: best.m.predictors, looR2: best.m.looR2 ?? 0, n: best.m.skill!.n } : null;
  const retro = best ? best.rows.map((r, i) => ({ wy: r.wy, actual: r.runoff as number, pred: best.loo[i] })) : [];
  const rows = best ? best.rows : [];

  // climatología 1991–2020 del aporte abril–julio
  const clim = [...runoff.entries()].filter(([y]) => y >= 1991 && y <= 2020);
  const cv = clim.map(([, v]) => v);
  const minE = clim.length ? clim.reduce((a, b) => (b[1] < a[1] ? b : a)) : null;
  const maxE = clim.length ? clim.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
  const climatology = {
    from: 1991, to: 2020, n: cv.length,
    median: quantile(cv, 0.5), mean: cv.length ? cv.reduce((a, b) => a + b, 0) / cv.length : null,
    p10: quantile(cv, 0.1), p90: quantile(cv, 0.9),
    min: minE ? { wy: minE[0], af: minE[1] } : null, max: maxE ? { wy: maxE[0], af: maxE[1] } : null,
  };

  // estimación actual
  const runoffYear = wy; // abril–julio del año hidrológico en curso
  let estimate: ModelOut["estimate"] = null;
  let analogYears: number[] | null = null;
  const reasons: string[] = [];
  let reason: string | null = null;
  if (!inSeason) reason = "Fuera de la temporada de acumulación (1-oct → 1-abr): el modelo se muestra sólo como referencia histórica al 1-abr. La próxima estimación empieza el 1-oct.";
  else if (!best) reason = "No hay suficientes años con datos para ajustar una relación confiable.";
  else {
    const x = best.m.predictors.map((p) => current[p as P]);
    if (x.some((v) => v == null)) reason = "Faltan datos actuales de las estaciones para calcular el índice.";
    else {
      const c = best.predictNow(x as number[]);
      if (c == null) reason = "No se pudo calcular la estimación.";
      else {
        estimate = { low: Math.max(0, c - halfWidth!), central: Math.max(0, c), high: Math.max(0, c + halfWidth!) };
        if (best === an) analogYears = an.analogYearsNow(x as number[]);
      }
    }
  }

  // confianza (reglas documentadas)
  let level: ModelOut["confidence"]["level"] = "insuficiente", score: number | null = null;
  if (estimate && chosen) {
    const f = { looR2: chosen.looR2, n: chosen.n };
    const coverage = sw.used ? sw.now / sw.used : 0;
    const daysToApr = Math.round((Date.parse(`${wy}-04-01T00:00:00Z`) - Date.parse(today + "T00:00:00Z")) / DAY);
    const xs = rows.map((r) => r[chosen.predictors[0] as P]).filter((v): v is number => v != null);
    const xNow = current[chosen.predictors[0] as P] as number;
    const inRange = xs.length ? xNow >= Math.min(...xs) && xNow <= Math.max(...xs) : false;
    if (coverage < 0.5 || f.looR2 < 0.3) {
      level = "insuficiente";
      reasons.push(coverage < 0.5 ? `Sólo ${Math.round(coverage * 100)} % de las estaciones del índice reportan hoy.` : `La relación histórica a esta fecha es débil (R² de validación ${f.looR2.toFixed(2)} < 0,30).`);
    } else {
      score = 0;
      if (coverage >= 0.8) { score++; reasons.push(`Cobertura: ${Math.round(coverage * 100)} % de las estaciones del índice reportan (+1).`); }
      else reasons.push(`Cobertura: ${Math.round(coverage * 100)} % de las estaciones (0).`);
      if (f.looR2 >= 0.7) { score += 2; reasons.push(`Relación histórica fuerte: R² de validación ${f.looR2.toFixed(2)} (+2).`); }
      else if (f.looR2 >= 0.5) { score++; reasons.push(`Relación histórica moderada: R² de validación ${f.looR2.toFixed(2)} (+1).`); }
      else reasons.push(`Relación histórica débil: R² de validación ${f.looR2.toFixed(2)} (0).`);
      if (inRange) { score++; reasons.push("El índice actual está dentro del rango de los años usados (+1)."); }
      else { score--; reasons.push("El índice actual está fuera del rango histórico: es una extrapolación (−1)."); }
      if (daysToApr <= 45) { score++; reasons.push(`Faltan ${daysToApr} días para el 1-abr (+1).`); }
      else if (daysToApr > 90) { score--; reasons.push(`Faltan ${daysToApr} días para el 1-abr: todavía puede nevar mucho (−1).`); }
      else reasons.push(`Faltan ${daysToApr} días para el 1-abr (0).`);
      if (f.n < 25) { score--; reasons.push(`Sólo ${f.n} años en el ajuste (−1).`); }
      level = score >= 4 ? "alta" : score >= 2 ? "media" : "baja";
    }
  } else if (reason) reasons.push(reason);

  return {
    v: MODEL_V, builtAt: new Date(now).toISOString(), today, wy, runoffYear, md, inSeason, reason,
    years, stationsUsed: sw.used, stationsNow: sw.now,
    current,
    models, chosen: chosen?.name ?? null, retro, halfWidth, analogYears,
    estimate, climatology,
    observedSoFar: csv ? aprJulSoFar(csv as string, wy) : null,
    confidence: { level, score, reasons },
  };
}
