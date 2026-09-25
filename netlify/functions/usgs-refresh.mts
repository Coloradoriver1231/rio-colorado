/** Función programada: cada 15 min trae USGS y guarda el último dato bueno (y los errores) en Netlify Blobs. */
import type { Config } from "@netlify/functions";
import { fetchUsgs, loadSaved, merge, save } from "../lib/usgs";

export default async () => {
  const r = await fetchUsgs(25000);
  await save(merge(await loadSaved(), r.gauges, new Date(), r.errors));
  console.log(`usgs-refresh: ${Object.keys(r.gauges).length} estaciones; errores: ${r.errors.join("; ") || "ninguno"}`);
};

export const config: Config = { schedule: "*/15 * * * *" };
