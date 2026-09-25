/**
 * Funciones puras compartidas por las funciones de Netlify (y testeadas con Vitest).
 * Nada acá hace red: sólo parsea y calcula.
 */

export type Pt = [string, number]; // [YYYY-MM-DD, valor]


const DAY = 86400e3;
export const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
export const dayMs = (d: string) => Date.parse(d.slice(0, 10) + "T00:00:00Z");

export function last(pts: Pt[]): Pt | null {
  return pts.length ? pts[pts.length - 1] : null;
}

/** Valor en la fecha `d` o el dato anterior más cercano dentro de `tolDays`. */
export function valueAt(pts: Pt[], d: string, tolDays = 3): number | null {
  const target = dayMs(d);
  for (let i = pts.length - 1; i >= 0; i--) {
    const t = dayMs(pts[i][0]);
    if (t <= target) return target - t <= tolDays * DAY ? pts[i][1] : null;
  }
  return null;
}

/** Distancia en km (haversine). */
export function km(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371, r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** CSV simple con comillas (para meta.csv de HDB). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export type HdbSite = { site_id: number; name: string; lat: number; lon: number; datatypes: number[] };

/** meta.csv de HDB -> sitios con sus datatypes. Busca columnas por nombre (no por posición). */
export function parseHdbMeta(text: string): HdbSite[] {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const h = rows[0].map((x) => x.trim());
  const col = (name: string) => h.indexOf(name);
  const iSite = col("site_id"), iDt = col("datatype_id");
  const iName = col("site_metadata.site_common_name") >= 0 ? col("site_metadata.site_common_name") : col("site_metadata.site_name");
  const iLat = col("site_metadata.lat"), iLon = col("site_metadata.longi");
  if (iSite < 0 || iDt < 0 || iLat < 0 || iLon < 0) return [];
  const by = new Map<number, HdbSite>();
  for (const r of rows.slice(1)) {
    const id = Number(r[iSite]), dt = Number(r[iDt]), lat = Number(r[iLat]), lon = Number(r[iLon]);
    if (!Number.isFinite(id) || !Number.isFinite(dt)) continue;
    let s = by.get(id);
    if (!s) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      s = { site_id: id, name: (r[iName] || "").trim(), lat, lon, datatypes: [] };
      by.set(id, s);
    }
    if (!s.datatypes.includes(dt)) s.datatypes.push(dt);
  }
  return [...by.values()];
}

/** Empareja un embalse NRCS con el sitio HDB con almacenamiento (dt 17) más cercano, a menos de `maxKm`. */
export function matchHdb(lat: number, lon: number, sites: HdbSite[], maxKm = 5): HdbSite | null {
  let best: HdbSite | null = null, bd = Infinity;
  for (const s of sites) {
    if (!s.datatypes.includes(17)) continue;
    const d = km(lat, lon, s.lat, s.lon);
    if (d < bd) { bd = d; best = s; }
  }
  return bd <= maxKm ? best : null;
}

/** Subcuencas por HUC de 4 dígitos (nombres oficiales USGS). */
export const HUC4: Record<string, string> = {
  "1401": "Colorado Headwaters",
  "1402": "Gunnison",
  "1403": "Upper Colorado–Dolores",
  "1404": "Great Divide–Upper Green",
  "1405": "White–Yampa",
  "1406": "Lower Green",
  "1407": "Upper Colorado–Dirty Devil (Powell)",
  "1408": "San Juan",
  "1501": "Lower Colorado–Lake Mead (Virgin)",
  "1502": "Little Colorado",
  "1503": "Lower Colorado",
  "1504": "Upper Gila",
  "1505": "Middle Gila",
  "1506": "Salt",
  "1507": "Lower Gila",
  "1508": "Sonora",
};

/** Parser de valores diarios NRCS AWDB: acepta date "YYYY-MM-DD" o year/month (mensual). */
export function parseAwdbValues(values: any[]): Pt[] {
  const out: Pt[] = [];
  for (const x of values || []) {
    if (!x || typeof x.value !== "number" || !Number.isFinite(x.value)) continue;
    let d: string | null = null;
    if (typeof x.date === "string") {
      if (/^\d{4}-\d{2}-\d{2}/.test(x.date)) d = x.date.slice(0, 10);
      else if (/^\d{4}-\d{2}$/.test(x.date)) d = endOfMonth(x.date);
    } else if (Number.isFinite(x.year) && Number.isFinite(x.month)) {
      d = endOfMonth(`${x.year}-${String(x.month).padStart(2, "0")}`);
    }
    if (d) out.push([d, x.value]);
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return out;
}

function endOfMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return isoDay(Date.UTC(y, m, 0));
}

