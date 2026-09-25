/**
 * /api/basin → todos los embalses de la cuenca del Colorado según NRCS AWDB (USDA):
 * HUC 14 = Cuenca Alta, HUC 15 = Cuenca Baja (incluye Gila, Salt y Verde).
 *  - capacidad útil de cada embalse (reservoirMetadata)
 *  - almacenamiento diario (RESC, acre-feet); si un embalse no tiene diario reciente, el último dato mensual
 *  - vínculo con el sitio de USBR hydrodata (meta.csv) por cercanía (< 5 km), para cruzar con el catálogo
 * Cache CDN 3 h (los datos son diarios).
 */
import type { Config } from "@netlify/functions";
import { get, json } from "../lib/net";
import { HUC4, isoDay, last, matchHdb, parseAwdbValues, parseHdbMeta, type HdbSite, type Pt, valueAt } from "../lib/hydro";

const AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";
const HDB_META = "https://www.usbr.gov/uc/water/hydrodata/reservoir_data/meta.csv";
const DAY = 86400e3;

async function storage(ids: string[], duration: "DAILY" | "MONTHLY", begin: string, end: string) {
  const out = new Map<string, Pt[]>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 25) chunks.push(ids.slice(i, i + 25));
  const got = await Promise.all(
    chunks.map((c) => get(`${AWDB}/data?stationTriplets=${encodeURIComponent(c.join(","))}&elements=RESC&duration=${duration}&beginDate=${begin}&endDate=${end}`, "json")),
  );
  for (const arr of got)
    if (Array.isArray(arr))
      for (const st of arr) {
        const pts = parseAwdbValues(st?.data?.[0]?.values || []);
        if (pts.length) out.set(String(st.stationTriplet), pts);
      }
  return out;
}

export default async () => {
  const now = Date.now();
  const today = isoDay(now);
  const [stations, metaTxt] = await Promise.all([
    get(`${AWDB}/stations?stationTriplets=*:*:BOR&hucs=14*,15*&elements=RESC&returnReservoirMetadata=true&activeOnly=true`, "json"),
    get(HDB_META, "text"),
  ]);
  if (!Array.isArray(stations) || !stations.length) return json({ error: "NRCS no respondió la lista de embalses" }, 502, "public, s-maxage=120");
  const hdb: HdbSite[] = metaTxt ? parseHdbMeta(metaTxt) : [];

  const seen = new Set<string>();
  const list = stations.filter((s: any) => {
    const id = String(s?.stationTriplet || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return /^1[45]/.test(String(s.huc || "")) && Number.isFinite(s.latitude) && Number.isFinite(s.longitude);
  });
  const ids = list.map((s: any) => String(s.stationTriplet));

  const daily = await storage(ids, "DAILY", isoDay(now - 380 * DAY), today);
  const fresh = (p?: Pt[]) => !!p?.length && now - Date.parse(last(p)![0] + "T00:00:00Z") <= 10 * DAY;
  const needMonthly = ids.filter((id) => !fresh(daily.get(id)));
  const monthly = needMonthly.length ? await storage(needMonthly, "MONTHLY", isoDay(now - 800 * DAY), today) : new Map<string, Pt[]>();

  const reservoirs = list.map((s: any) => {
    const id = String(s.stationTriplet);
    const huc = String(s.huc);
    const cap = Number(s.reservoirMetadata?.usableCapacity) || Number(s.reservoirMetadata?.capacity) || 0;
    const m = hdb.length ? matchHdb(s.latitude, s.longitude, hdb) : null;
    const d = daily.get(id), mo = monthly.get(id);
    const useMonthly = !fresh(d) && !!mo?.length && (!d?.length || last(mo)![0] > last(d)![0]);
    const pts = useMonthly ? mo! : d || [];
    const lp = pts.length ? last(pts)! : null;
    const back = (n: number) => {
      if (!lp) return null;
      const v = valueAt(pts, isoDay(Date.parse(lp[0] + "T00:00:00Z") - n * DAY), useMonthly ? 20 : 3);
      return v;
    };
    const v7 = useMonthly ? null : back(7), v30 = back(30), v365 = back(365);
    return {
      id,
      name: String(s.name || id).trim(),
      state: String(s.stateCode || ""),
      basin: huc.startsWith("14") ? "alta" : "baja",
      subbasin: HUC4[huc.slice(0, 4)] || huc.slice(0, 4),
      lat: Number(s.latitude),
      lon: Number(s.longitude),
      capacity_af: cap > 0 ? cap : null,
      hdb_site: m?.site_id ?? null,
      freq: lp ? (useMonthly ? "mensual" : "diario") : null,
      date: lp ? lp[0] : null,
      af: lp ? lp[1] : null,
      ch7: lp && v7 != null ? lp[1] - v7 : null,
      ch30: lp && v30 != null ? lp[1] - v30 : null,
      last_year_af: v365,
    };
  });

  return json(
    { fetchedAt: new Date(now).toISOString(), hdbLinked: hdb.length > 0, reservoirs },
    200,
    "public, durable, s-maxage=10800, stale-while-revalidate=86400",
  );
};

export const config: Config = { path: "/api/basin" };
