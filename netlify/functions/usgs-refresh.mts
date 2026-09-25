/** Función programada: cada 15 min trae USGS y guarda el último dato bueno en Netlify Blobs. */
import type { Config } from "@netlify/functions";
import { fetchUsgs, loadSaved, merge, save } from "../lib/usgs";

export default async () => {
  const r = await fetchUsgs(25000);
  if (Object.keys(r.gauges).length) await save(merge(await loadSaved(), r.gauges));
  console.log(`usgs-refresh: ${Object.keys(r.gauges).length} estaciones; errores: ${r.errors.join("; ") || "ninguno"}`);
};

export const config: Config = { schedule: "*/15 * * * *" };
