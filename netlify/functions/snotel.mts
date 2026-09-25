/**
 * /api/snotel/<estación>?wy=<año hidrológico> → serie diaria de UNA estación SNOTEL:
 * SWE (con mediana 1991–2020), altura de nieve y precipitación acumulada (con mediana), del 1-oct al 30-sep (o hasta hoy).
 * Cache CDN 3 h.
 */
import type { Config } from "@netlify/functions";
import { readJson } from "../lib/blob";
import { json } from "../lib/net";
import { addDays, awdbDaily, isoDay, waterYear, wyStartOf, type Station } from "../lib/snow";

export default async (req: Request) => {
  const u = new URL(req.url);
  const id = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
  if (!/^\d{1,5}:[A-Z]{2}:SNTL$/.test(id)) return json({ error: "estación inválida" }, 400, "no-store");
  const today = isoDay(Date.now());
  const cur = waterYear(today);
  const wy = Number(u.searchParams.get("wy") || cur);
  if (!Number.isInteger(wy) || wy < 1980 || wy > cur) return json({ error: "año inválido" }, 400, "no-store");
  const begin = wyStartOf(wy);
  const end = wy === cur ? today : addDays(`${wy}-10-01`, -1);

  const [r, list] = await Promise.all([
    awdbDaily([id], "WTEQ,SNWD,PREC", begin, end, true, 1, 1, 9000, 9500),
    readJson<Station[]>("snotel-stations"),
  ]);
  const d = r.data.get(id);
  if (!d) return json({ error: "NRCS no devolvió datos de esta estación" }, 502, "public, s-maxage=60");
  const meta = list?.find((s) => s.id === id) || null;
  const num = id.split(":")[0];
  return json(
    {
      id, wy, begin, end, meta,
      swe: d.WTEQ || [], depth: d.SNWD || [], prec: d.PREC || [],
      links: {
        nrcs: `https://wcc.sc.egov.usda.gov/nwcc/site?sitenum=${num}`,
        report: `https://wcc.sc.egov.usda.gov/reportGenerator/view/customSingleStationReport/daily/${encodeURIComponent(id)}%7Cid=%22%22%7Cname/-30,0/WTEQ::value,WTEQ::median_1991,SNWD::value,PREC::value`,
      },
    },
    200,
    wy === cur ? "public, durable, s-maxage=10800, stale-while-revalidate=21600" : "public, durable, s-maxage=604800",
  );
};

export const config: Config = { path: "/api/snotel/*" };
