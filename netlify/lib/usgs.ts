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

/**
 * `budgetMs`: tiempo total disponible (la API responde en ≤10 s; la función programada tiene 30 s).
 * 1) waterservices (clásico): 3 tandas en paralelo, un intento, hasta el 40 % del tiempo.
 * 2) API nueva (continuous, por estación, 6 a la vez) para lo que falte, con el resto del tiempo.
 */
export async function fetchUsgs(budgetMs: number): Promise<UsgsResult> {
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  const gauges: Record<string, GaugeOut> = {};
  const errors: string[] = [];

  const chunks: string[][] = [];
  for (let i = 0; i < IDS.length; i += 9) chunks.push(IDS.slice(i, i + 9));
  const legacyMs = Math.min(8000, budgetMs * 0.4);
  await Promise.all(
    chunks.map(async (c) => {
      const r = await fetchJson(`https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${c.join(",")}&parameterCd=00060&period=P7D&siteStatus=all`, legacyMs);
      if (r.ok) {
        try { Object.assign(gauges, parseUsgsIv(r.j)); } catch { errors.push("waterservices: formato inesperado"); }
      } else errors.push(`waterservices: ${r.err}`);
    }),
  );

  const missing = IDS.filter((id) => !gauges[id]?.series.length);
  if (missing.length && left() > 1500) {
    const key = process.env.USGS_API_KEY || "";
    const hdr: Record<string, string> = key ? { "X-Api-Key": key } : {};
    const since = new Date(Date.now() - 7 * 86400e3).toISOString().replace(/\.\d{3}Z$/, "Z");
    const queue = [...missing];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        const ms = Math.min(7000, left() - 200);
        if (ms < 1200) { errors.push("api.waterdata: sin tiempo para todas las estaciones"); return; }
        const r = await fetchJson(
          `https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items?f=json&monitoring_location_id=USGS-${id}` +
            `&parameter_code=00060&datetime=${since}/..&limit=10000&properties=time,value&skipGeometry=true`,
          ms, hdr,
        );
        if (r.ok) {
          const series = parseUsgsOgcContinuous(r.j);
          if (series.length) gauges[id] = { id, name: NAMES[id] || id, lat: null, lon: null, series };
        } else errors.push(`api.waterdata: ${r.err}`);
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
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
