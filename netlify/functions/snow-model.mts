/** Programada una vez por día: recalcula la "Estimación del monitor" (relación histórica nieve → aporte abril–julio). */
import type { Config } from "@netlify/functions";
import { writeJson } from "../lib/blob";
import { buildModel } from "../lib/snow";

export default async () => {
  const m = await buildModel();
  if (m) await writeJson("snow-model", m);
  console.log(m ? `snow-model: ${m.years.length} años, modelo ${m.chosen ?? "ninguno"}, confianza ${m.confidence.level}` : "snow-model: sin datos");
};

export const config: Config = { schedule: "23 11 * * *" };
