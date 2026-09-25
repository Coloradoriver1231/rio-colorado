/**
 * Lectura de caudales USGS con respaldo:
 *  1. waterservices.usgs.gov (IV, 7 días) en 3 tandas en paralelo, con 1 reintento cada una.
 *  2. Para las estaciones que falten: API nueva api.waterdata.usgs.gov (colección "continuous"), por estación.
 * Nunca inventa: una estación sin datos simplemente no aparece.
 */
import { getStore } from "@netlify/blobs";
import catalog from "../../src/data/catalog.json";
import { parseUsgsIv, parseUsgsOgcContinuous, type GaugeOut } from "../../src/shared/process";

export const IDS: string[] = (catalog as any).gauges.map((g: any) => g.id);
const NAMES: Record<string, string> = Object.fromEntries((catalog as any).gauges.map((g: any) => [g.id, g.name]));
const UA = "rio-colorado-monitor/1.0 (monitoreo hidrologico personal; consulta cada 15 min)";

async function fetchJson(url: string, ms: number, headers: Record<string, string> = {}): Promise<{ ok: true; j: any } | { ok: false; err: string }> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json", ...headers }, signal: ctl.signal });
    if (!r.ok) return { ok: false, err: `HTTP ${r.status}` };
    return { ok: true, j: await r.json() };
  } catch (e: any) {
    return { ok: false, err: e?.name === "AbortError" ? "sin respuesta a tiempo" : String(e?.message || e) };
  } finally {
    clearTimeout(to);
  }
}

export interface UsgsResult {
  gauges: Record<string, GaugeOut>;
  errors: string[];
}

/** USGS da de baja waterservices.usgs.gov el 22-feb-2027: desde esa fecha no se lo consulta más. */
export const LEGACY_SUNSET = Date.parse("2027-02-22T00:00:00Z");
const OGC = "https://api.waterdata.usgs.gov/ogcapi";
/** Caudal 00060 = pies cúbicos por segundo. Si la API informara metros cúbicos, el dato se descarta (no se mezclan unidades). */
const METRIC = /(^|[^f])m\^?3|m³|cms|cubic meter/i;

/**
 * `budgetMs`: tiempo total disponible (la API responde en ≤10 s; la función programada tiene 30 s).
 * 1) API nueva (OGC "continuous", v1 y si falla v0), una consulta por estación, 6 a la vez.
 * 2) Sólo para lo que falte y sólo antes del 22-feb-2027: waterservices (clásico).
 * Un 429 (límite de consultas) corta la ronda para no empeorar el bloqueo.
 */
export async function fetchUsgs(budgetMs: number, now = Date.now()): Promise<UsgsResult> {
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  const gauges: Record<string, GaugeOut> = {};
  const errors: string[] = [];
  const key = process.env.USGS_API_KEY || "";
  const hdr: Record<string, string> = key ? { "X-Api-Key": key } : {};
  const since = new Date(now - 7 * 86400e3).toISOString().replace(/\.\d{3}Z$/, "Z");
  let limited = false;

  const queue = [...IDS];
  const worker = async () => {
    for (let id = queue.shift(); id && !limited; id = queue.shift()) {
      for (const v of ["v1", "v0"]) {
        const ms = Math.min(7000, left() - 300);
        if (ms < 1200) { errors.push("api.waterdata: sin tiempo para todas las estaciones"); return; }
        const r = await fetchJson(
          `${OGC}/${v}/collections/continuous/items?f=json&monitoring_location_id=USGS-${id}` +
            `&parameter_code=00060&datetime=${since}/..&limit=10000&properties=time,value,unit_of_measure&skipGeometry=true`,
          ms, hdr,
        );
        if (r.ok) {
          const units = new Set((r.j?.features || []).map((f: any) => f?.properties?.unit_of_measure).filter(Boolean));
          const bad = [...units].filter((u) => METRIC.test(String(u)));
          if (bad.length) { errors.push(`api.waterdata ${id}: unidad inesperada ${bad.join(",")}`); break; }
          const series = parseUsgsOgcContinuous(r.j);
          if (series.length) gauges[id] = { id, name: NAMES[id] || id, lat: null, lon: null, series };
          break; // respuesta válida (aunque vacía): no probar la otra versión
        }
        if (r.err === "HTTP 429") { limited = true; errors.push("api.waterdata: límite de consultas (HTTP 429)"); return; }
        if (v === "v0") errors.push(`api.waterdata: ${r.err}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  const missing = IDS.filter((id) => !gauges[id]?.series.length);
  if (missing.length && now < LEGACY_SUNSET && left() > 2000) {
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += 9) chunks.push(missing.slice(i, i + 9));
    await Promise.all(chunks.map(async (c) => {
      const r = await fetchJson(`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${c.join(",")}&parameterCd=00060&period=P7D&siteStatus=all`, Math.min(8000, left() - 200));
      if (r.ok) { try { Object.assign(gauges, parseUsgsIv(r.j)); } catch { errors.push("waterservices: formato inesperado"); } }
      else errors.push(`waterservices: ${r.err}`);
    }));
  }
  return { gauges, errors: [...new Set(errors)] };
}

/* ----------------------- último dato bueno (Netlify Blobs) ----------------------- */

export interface Saved { savedAt: string; gauges: Record<string, GaugeOut & { updatedAt: string }>; lastRunAt?: string; lastErrors?: string[] }

const store = () => getStore({ name: "rio-colorado" });

export async function loadSaved(): Promise<Saved | null> {
  try { return ((await store().get("usgs", { type: "json" })) as Saved) || null; } catch { return null; }
}

/** Combina lo nuevo con lo guardado: si una estación no vino ahora, queda la anterior (con su fecha). */
export function merge(prev: Saved | null, fresh: Record<string, GaugeOut>, now = new Date(), errors: string[] = []): Saved {
  const out: Saved["gauges"] = {};
  const cutoff = now.getTime() - 8 * 86400e3;
  for (const id of IDS) {
    const f = fresh[id];
    if (f?.series.length) out[id] = { ...f, updatedAt: now.toISOString() };
    else if (prev?.gauges[id]) out[id] = { ...prev.gauges[id], series: prev.gauges[id].series.filter((p) => p[0] >= cutoff) };
  }
  const any = Object.keys(fresh).length > 0;
  return { savedAt: any ? now.toISOString() : prev?.savedAt || now.toISOString(), gauges: out, lastRunAt: now.toISOString(), lastErrors: errors };
}

export async function save(s: Saved) {
  try { await store().setJSON("usgs", s); } catch { /* sin Blobs (p. ej. local): se sigue sin guardar */ }
}
