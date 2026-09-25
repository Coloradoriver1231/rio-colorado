/** Programada: recalcula el indicador del Compact una vez por día (se intenta cada hora hasta lograrlo). */
import type { Config } from "@netlify/functions";
import { readJson, writeJson } from "../lib/blob";
import { buildCompact } from "../lib/compact";

export default async () => {
  const prev: any = await readJson("compact");
  const today = new Date().toISOString().slice(0, 10);
  if (prev?.v === 1 && prev.today === today) return;
  const r = await buildCompact(12000);
  if (!("error" in r)) await writeJson("compact", r);
  console.log("error" in r ? `compact-refresh: ${r.error}` : `compact-refresh: ${r.rolling.length} sumas de 10 años (${r.api})`);
};

export const config: Config = { schedule: "41 * * * *" };
