/** /api/compact → caudal en Lee Ferry por año hidrológico y suma móvil de 10 años (cálculo del monitor, USGS). */
import type { Config } from "@netlify/functions";
import { readJson, writeJson } from "../lib/blob";
import { json } from "../lib/net";
import { buildCompact } from "../lib/compact";

export default async () => {
  let c: any = await readJson("compact");
  if (!c || c.v !== 1) {
    const r = await buildCompact(2800);
    if ("error" in r) return json({ error: r.error }, 502, "public, s-maxage=600");
    c = r;
    await writeJson("compact", c);
  }
  return json(c, 200, "public, durable, s-maxage=3600, stale-while-revalidate=86400");
};

export const config: Config = { path: "/api/compact" };
