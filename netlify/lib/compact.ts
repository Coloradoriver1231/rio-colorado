/**
 * Indicador del Compact del Río Colorado (1922), Artículo III(d): la Cuenca Alta no debe hacer que el caudal en
 * Lee Ferry baje de 75 millones de acre-feet (MAF) en cualquier período de 10 años consecutivos.
 * Se suele citar también 82,5 MAF = 75 + 7,5 (la mitad de la entrega anual a México de 1,5 MAF según el tratado de 1944),
 * cuya aplicación está en discusión entre los estados.
 *
 * "Lee Ferry" (el punto legal, 1 milla aguas abajo de la confluencia con el Paria) ≈ Colorado en Lees Ferry (USGS 09380000)
 * + Paria en Lees Ferry (USGS 09382000). Cálculo del monitor con caudales diarios de USGS; la contabilidad oficial
 * la publican USBR y la Upper Colorado River Commission.
 */
import { get } from "./net";

export const SITES = { lees: "09380000", paria: "09382000" } as const;
export const CFS_DAY_AF = 1.983471;
const OGC = "https://api.waterdata.usgs.gov/ogcapi";
export const LEGACY_SUNSET = Date.parse("2027-02-22T00:00:00Z");

export type Pt = [string, number];

export function parseDailyOgc(j: any): Pt[] {
  const out: Pt[] = [];
  for (const f of Array.isArray(j?.features) ? j.features : []) {
    const p = f?.properties || {};
    const d = typeof p.time === "string" ? p.time.slice(0, 10) : "";
    const v = p.value === null || p.value === "" ? NaN : Number(p.value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(v) && v >= 0) out.push([d, v]);
  }
  return dedup(out);
}

export function parseDailyLegacy(j: any): Pt[] {
  const ts = j?.value?.timeSeries?.[0];
  const nd = Number(ts?.variable?.noDataValue ?? -999999);
  const out: Pt[] = [];
  for (const b of ts?.values || []) for (const x of b.value || []) {
    const v = Number(x.value);
    if (Number.isFinite(v) && v !== nd && v >= 0) out.push([String(x.dateTime).slice(0, 10), v]);
  }
  return dedup(out);
}

function dedup(p: Pt[]): Pt[] {
  p.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const o: Pt[] = [];
  for (const x of p) { if (o.length && o[o.length - 1][0] === x[0]) o[o.length - 1] = x; else o.push(x); }
  return o;
}

export async function dailyFlow(site: string, from: string, now = Date.now(), ms = 9000): Promise<{ pts: Pt[]; api: string } | null> {
  const key = process.env.USGS_API_KEY || "";
  const hdr: Record<string, string> = key ? { "X-Api-Key": key } : {};
  for (const v of ["v1", "v0"]) {
    const j = await get(`${OGC}/${v}/collections/daily/items?f=json&monitoring_location_id=USGS-${site}&parameter_code=00060&statistic_id=00003&datetime=${from}/..&limit=50000&properties=time,value&skipGeometry=true`, "json", ms, hdr);
    const pts = j ? parseDailyOgc(j) : [];
    if (pts.length) return { pts, api: `api.waterdata.usgs.gov ${v}` };
  }
  if (now < LEGACY_SUNSET) {
    const j = await get(`https://waterservices.usgs.gov/nwis/dv/?format=json&sites=${site}&parameterCd=00060&statCd=00003&startDT=${from}&siteStatus=all`, "json", ms);
    const pts = j ? parseDailyLegacy(j) : [];
    if (pts.length) return { pts, api: "waterservices.usgs.gov" };
  }
  return null;
}

const wyOf = (d: string) => Number(d.slice(0, 4)) + (Number(d.slice(5, 7)) >= 10 ? 1 : 0);
const daysInWy = (wy: number) => ((wy % 4 === 0 && wy % 100 !== 0) || wy % 400 === 0 ? 366 : 365);

/** Volumen por año hidrológico (acre-feet) sin rellenar huecos; un año con < 99 % de días no cuenta como completo. */
export function wyVolumes(pts: Pt[]): Map<number, { af: number; days: number; complete: boolean }> {
  const m = new Map<number, { af: number; days: number; complete: boolean }>();
  for (const [d, v] of pts) {
    const wy = wyOf(d);
    const r = m.get(wy) || { af: 0, days: 0, complete: false };
    r.af += v * CFS_DAY_AF; r.days++;
    m.set(wy, r);
  }
  for (const [wy, r] of m) r.complete = r.days >= 0.99 * daysInWy(wy);
  return m;
}

export interface CompactOut {
  years: { wy: number; lees: number | null; paria: number | null; total: number | null; complete: boolean }[];
  rolling: { wy: number; af: number }[];
  current: { wy: number; af: number; days: number; to: string } | null;
  thresholds: { compact: number; withMexico: number };
}

export function compactCalc(lees: Pt[], paria: Pt[], today: string): CompactOut {
  const L = wyVolumes(lees), P = wyVolumes(paria);
  const cur = wyOf(today);
  const ys = [...new Set([...L.keys(), ...P.keys()])].filter((y) => y < cur).sort((a, b) => a - b);
  const years = ys.map((wy) => {
    const l = L.get(wy), p = P.get(wy);
    const complete = !!l?.complete && !!p?.complete;
    return { wy, lees: l?.af ?? null, paria: p?.af ?? null, total: complete ? l!.af + p!.af : null, complete };
  });
  const byWy = new Map(years.map((y) => [y.wy, y]));
  const rolling: { wy: number; af: number }[] = [];
  for (const y of years) {
    let s = 0, ok = true;
    for (let k = y.wy - 9; k <= y.wy; k++) { const t = byWy.get(k)?.total; if (t == null) { ok = false; break; } s += t; }
    if (ok) rolling.push({ wy: y.wy, af: s });
  }
  const lc = L.get(cur), pc = P.get(cur);
  const lastDay = [lees.at(-1)?.[0], paria.at(-1)?.[0]].filter(Boolean).sort()[0] || today;
  return {
    years, rolling,
    current: lc ? { wy: cur, af: lc.af + (pc?.af ?? 0), days: lc.days, to: lastDay } : null,
    thresholds: { compact: 75e6, withMexico: 82.5e6 },
  };
}

export async function buildCompact(ms: number) {
  const from = "1990-10-01";
  const [l, p] = await Promise.all([dailyFlow(SITES.lees, from, Date.now(), ms), dailyFlow(SITES.paria, from, Date.now(), ms)]);
  if (!l || !p) return { error: `USGS no devolvió ${!l ? "Lees Ferry" : "Paria"}` } as const;
  const today = new Date().toISOString().slice(0, 10);
  return { v: 1, builtAt: new Date().toISOString(), today, api: l.api, ...compactCalc(l.pts, p.pts, today) };
}
