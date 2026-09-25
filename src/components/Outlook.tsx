import { useEffect, useMemo, useState } from "react";
import type { Cpc, CpcCell, Weather10 } from "../../netlify/lib/outlook";
import { fdate, num, type Units } from "../lib/units";
import EChart, { baseOption, theme } from "./EChart";

export type OutlookData = { weather: Weather10 | null; weatherError: string | null; points: number; regions: { id: string; name: string }[]; cpc: Cpc };
export type OutlookState = { state: "loading" | "ok" | "error"; data?: OutlookData; error?: string; at?: number };

export function useOutlook(): OutlookState {
  const [d, setD] = useState<OutlookState>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    fetch(`/api/outlook?b=${Math.floor(Date.now() / 3600e3)}`)
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (!alive) return;
        setD(r.ok && b ? { state: "ok", data: b, at: Date.now() } : { state: "error", error: b?.error || `HTTP ${r.status}` });
      })
      .catch((e) => alive && setD({ state: "error", error: String(e?.message || e) }));
    return () => { alive = false; };
  }, []);
  return d;
}

const snowTxt = (cm: number | null, u: Units) => (cm == null ? "—" : u === "metric" ? `${num(cm, cm < 10 ? 1 : 0)} cm` : `${num(cm / 2.54, 1)} in`);
const water = (mm: number | null, u: Units) => (mm == null ? "—" : u === "metric" ? `${num(mm, mm < 10 ? 1 : 0)} mm` : `${num(mm / 25.4, 2)} in`);

/* ------------------------------------------------------------------ 10 días */
export function Next10({ o, u }: { o: OutlookState; u: Units }) {
  const t = theme();
  const w = o.data?.weather;
  const opt = useMemo(() => {
    if (!w) return null;
    const b = baseOption(t);
    const pal = [t.water, t.out, t.good, t.warn, t.bad, t.muted, t.ink, t.waterSoft];
    return {
      ...b,
      xAxis: { ...b.xAxis, type: "category", data: w.days.map((x) => fdate(x).replace(/ \d{4}$/, "")) },
      yAxis: { ...b.yAxis, name: u === "metric" ? "mm de agua" : "pulgadas de agua", scale: false, min: 0 },
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => (x == null ? "—" : `${num(x, 1)} ${u === "metric" ? "mm" : "in"}`) },
      series: w.regions.map((r, i) => ({
        name: r.name, type: "bar", data: r.precMm.map((x) => (x == null ? null : Math.round((u === "metric" ? x : x / 25.4) * 10) / 10)), itemStyle: { color: pal[i % pal.length] },
      })),
    };
  }, [w, u]);
  if (o.state === "loading") return <p className="muted">Cargando pronóstico…</p>;
  if (!w) return <p className="note warn">{o.data?.weatherError || o.error || "Sin pronóstico."}</p>;
  return (
    <>
      <EChart option={opt} style={{ height: 250 }} />
      <div className="tablewrap">
        <table className="restable plain">
          <thead>
            <tr>
              <th>Zona (Cuenca Alta)</th>
              <th className="num">Precipitación 10 d (agua)</th>
              <th className="num">…de eso, como nieve (agua)</th>
              <th className="num">Nieve nueva aprox.</th>
              {w.regions[0]?.blocks.map((b) => <th key={b.label} className="num hide-sm">{b.label}</th>)}
              <th className="hide-sm">Puntos de pronóstico</th>
            </tr>
          </thead>
          <tbody>
            {w.regions.map((r) => (
              <tr key={r.name}>
                <td><b>{r.name}</b></td>
                <td className="num">{water(r.totalPrecMm, u)}</td>
                <td className="num">{water(r.totalSnowWaterMm, u)}</td>
                <td className="num">{snowTxt(r.totalSnowCm, u)}</td>
                {r.blocks.map((b) => <td key={b.label} className="num hide-sm">{water(b.precMm, u)}</td>)}
                <td className="hide-sm"><span className="sub" title={r.pointNames.map((n, i) => `${n}${r.pointElevM[i] != null ? ` (${r.pointElevM[i]} m)` : ""}`).join("\n")}>
                  {r.points} estaciones SNOTEL: {r.pointNames.join(", ")}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="note list">
        <li><b>Precipitación</b> = mm de agua (lluvia + nieve derretida). <b>…como nieve</b> = la parte que cae como nieve, también en agua (precipitación − lluvia − chaparrones, según Open-Meteo). <b>Nieve nueva</b> = centímetros de nieve, que Open-Meteo calcula con una relación fija (7 cm de nieve ≈ 10 mm de agua); la nieve real puede ser más liviana o más densa. Son magnitudes distintas: no se suman.</li>
        <li><b>Puntos</b>: se pronostica en las 3 estaciones SNOTEL más altas de cada subcuenca (con su altura real). Representan las zonas altas donde se acumula la nieve, <b>no el promedio de toda la subcuenca</b> (en zonas bajas llueve más y nieva menos).</li>
        <li><b>Incertidumbre por horizonte</b> (cualitativa, sin porcentajes): días 1–3 la más confiable · días 4–5 aceptable para eventos grandes · días 6–7 baja · días 8–10 sólo tendencia. Después de 5–7 días la incertidumbre aumenta mucho.</li>
        <li>Fuente: {w.source} (<a href="https://open-meteo.com/" target="_blank" rel="noreferrer">open-meteo.com</a>) · pronóstico automático, no oficial (el oficial es del <a href="https://www.weather.gov/" target="_blank" rel="noreferrer">NWS</a>) · consultado {fdate(w.fetchedAt.slice(0, 10))}.</li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------ 3 meses */
function prcpText(c: CpcCell | null) {
  if (!c) return { t: "sin dato", k: "" };
  if (c.cat === "Above") return { t: `Más húmedo ${c.range ?? ""}`, k: "alto" };
  if (c.cat === "Below") return { t: `Más seco ${c.range ?? ""}`, k: "bajo" };
  if (c.cat === "Normal") return { t: `Cerca de lo normal ${c.range ?? ""}`, k: "normal" };
  return { t: "Igual probabilidad", k: "normal" };
}
function tempText(c: CpcCell | null) {
  if (!c) return "Temperatura: sin dato";
  if (c.cat === "Above") return `Temperatura: más cálido ${c.range ?? ""}`;
  if (c.cat === "Below") return `Temperatura: más frío ${c.range ?? ""}`;
  if (c.cat === "Normal") return `Temperatura: cerca de lo normal ${c.range ?? ""}`;
  return "Temperatura: igual probabilidad";
}
const SEASON: Record<string, string> = { JFM: "ene–mar", FMA: "feb–abr", MAM: "mar–may", AMJ: "abr–jun", MJJ: "may–jul", JJA: "jun–ago", JAS: "jul–sep", ASO: "ago–oct", SON: "sep–nov", OND: "oct–dic", NDJ: "nov–ene", DJF: "dic–feb" };
const seasonEs = (s: string | null) => (s ? s.replace(/^([A-Z]{3})/, (m) => SEASON[m] || m) : "—");

export function Months({ o }: { o: OutlookState }) {
  if (o.state === "loading") return <p className="muted">Cargando perspectiva de NOAA…</p>;
  const d = o.data;
  if (!d || !d.cpc.leads.some((l) => l.season)) return <p className="note warn">{d?.cpc.error || o.error || "Sin datos de NOAA CPC."}</p>;
  return (
    <>
      <div className="tablewrap">
        <table className="restable plain cpc">
          <thead><tr><th>Zona</th>{d.cpc.leads.map((l) => <th key={l.lead}>{seasonEs(l.season)}</th>)}</tr></thead>
          <tbody>
            {d.regions.map((r) => (
              <tr key={r.id}>
                <td><b>{r.name}</b></td>
                {d.cpc.leads.map((l) => {
                  const p = prcpText(l.prcp[r.id]);
                  return <td key={l.lead}><span className={`tag ${p.k}`}>{p.t}</span><span className="sub">{tempText(l.temp[r.id])}</span></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="note list">
        <li>Cada período de 3 meses se divide en tres tercios (seco / normal / húmedo) que normalmente tienen 33 % de chance cada uno. "Más húmedo 40–50 %" = la chance de caer en el tercio más lluvioso subió a 40–50 %. <b>No dice cuántos milímetros ni cuánta nieve va a caer.</b> "Igual probabilidad" = sin señal.</li>
        <li><b>Temperatura</b> (separada): influye en si cae lluvia o nieve, cuánto se acumula, cuándo empieza el deshielo, qué tan rápido escurre y cuánta nieve se pierde por sublimación. Pero "más cálido" <b>no</b> significa automáticamente "menos agua": depende de cuánto nieve y de cuándo haga calor.</li>
        <li>Se lee el valor de CPC en el centro de cada zona (un punto representativo, no toda la zona).</li>
        <li>Fuente: NOAA Climate Prediction Center, perspectiva estacional{d.cpc.issued ? ` emitida el ${fdate(d.cpc.issued)}` : ""} (se actualiza el tercer jueves de cada mes) · consultado {fdate(d.cpc.fetchedAt.slice(0, 10))} · <a href="https://www.cpc.ncep.noaa.gov/products/predictions/long_range/seasonal.php" target="_blank" rel="noreferrer">mapas de CPC</a>.{d.cpc.error ? ` ${d.cpc.error}.` : ""}</li>
      </ul>
    </>
  );
}
