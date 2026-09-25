/**
 * Programada cada hora, pero recalcula sólo una vez por día (si ya hay modelo de hoy, no hace nada):
 * así el primer cálculo aparece a más tardar una hora después de publicar.
 */
import type { Config } from "@netlify/functions";
import { readJson, writeJson } from "../lib/blob";
import { buildModel, isoDay, MODEL_V, type ModelOut } from "../lib/snow";

export default async () => {
  const prev = await readJson<ModelOut>("snow-model");
  if (prev && prev.v === MODEL_V && prev.today === isoDay(Date.now())) return;
  const m = await buildModel();
  if (m) await writeJson("snow-model", m);
  console.log(m ? `snow-model: ${m.years.length} años, modelo ${m.chosen ?? "ninguno"}, confianza ${m.confidence.level}` : "snow-model: sin datos");
};

export const config: Config = { schedule: "23 * * * *" };
