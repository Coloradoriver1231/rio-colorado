import { useEffect, useMemo, useState } from "react";
import type { Cpc, CpcCell, Weather10 } from "../../netlify/lib/outlook";
import { fdate, num, type Units } from "../lib/units";
import EChart, { baseOption, theme } from "./EChart";

type Data = { weather: Weather10 | null; weatherError: string | null; points: number; regions: { id: string; name: string }[]; cpc: Cpc };

const snow = (cm: number | null, u: Units) => (cm == null ? "—" : u === "metric" ? `${num(cm, cm < 10 ? 1 : 0)} cm` : `${num(cm / 2.54, 1)} in`);
const water = (mm: number | null, u: Units) => (mm == null ? "—" : u === "metric" ? `${num(mm, mm < 10 ? 1 : 0)} mm` : `${num(mm / 25.4, 2)} in`);

function prcpText(c: CpcCell | null) {
  if (!c) return { t: "sin dato", k: "" };
  if (c.cat === "Above") return { t: `Más húmedo ${c.range ?? ""}`, k: "alto" };
  if (c.cat === "Below") return { t: `Más seco ${c.range ?? ""}`, k: "muy-bajo" };
  if (c.cat === "Normal") return { t: `Cerca de lo normal ${c.range ?? ""}`, k: "normal" };
  return { t: "Igual probabilidad", k: "normal" };
}
function tempText(c: CpcCell | null) {
  if (!c) return "sin dato";
  if (c.cat === "Above") return `más cálido ${c.range ?? ""}`;
  if (c.cat === "Below") return `más frío ${c.range ?? ""}`;
  if (c.cat === "Normal") return `temperatura normal ${c.range ?? ""}`;
  return "temperatura: igual probabilidad";
}

const SEASON: Record<string, string> = { JFM: "ene–mar", FMA: "feb–abr", MAM: "mar–may", AMJ: "abr–jun", MJJ: "may–jul", JJA: "jun–ago", JAS: "jul–sep", ASO: "ago–oct", SON: "sep–nov", OND: "oct–dic", NDJ: "nov–ene", DJF: "dic–feb" };
const seasonEs = (s: string | null) => (s ? s.replace(/^([A-Z]{3})/, (m) => SEASON[m] || m) : "—");

export default function Outlook({ u }: { u: Units }) {
  const [d, setD] = useState<{ state: "loading" | "ok" | "error"; data?: Data; error?: string }>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    fetch(`/api/outlook?b=${Math.floor(Date.now() / 3600e3)}`)
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (!alive) return;
        setD(r.ok && b ? { state: "ok", data: b } : { state: "error", error: b?.error || `HTTP ${r.status}` });
      })
      .catch((e) => alive && setD({ state: "error", error: String(e?.message || e) }));
    return () => { alive = false; };
  }, []);

  const t = theme();
  const w = d.data?.weather;
  const opt = useMemo(() => {
    if (!w) return null;
    const b = baseOption(t);
    const pal = [t.water, t.out, t.good, t.warn, t.bad, t.muted];
    return {
      ...b,
      xAxis: { ...b.xAxis, type: "category", data: w.days.map((x) => fdate(x).replace(/ \d{4}$/, "")) },
      yAxis: { ...b.yAxis, name: u === "metric" ? "cm de nieve nueva" : "pulgadas de nieve nueva", scale: false, min: 0 },
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => (x == null ? "—" : `${num(x, 1)} ${u === "metric" ? "cm" : "in"}`) },
      series: w.regions.map((r, i) => ({
        name: r.name, type: "bar", data: r.snowCm.map((x) => (x == null ? null : Math.round((u === "metric" ? x : x / 2.54) * 10) / 10)), itemStyle: { color: pal[i % pal.length] },
      })),
    };
  }, [w, u]);

  return (
    <section className="card">
      <h2>Lo que viene — pronósticos (no son datos medidos)</h2>
      {d.state === "loading" && <p className="muted">Cargando pronósticos…</p>}
      {d.state === "error" && <p className="note warn">No se pudieron cargar los pronósticos: {d.error}</p>}
      {d.data && (
        <>
          <h3>Próximos 10 días <span className="tag">modelo meteorológico, no oficial</span></h3>
          {w ? (
            <>
              <EChart option={opt} style={{ height: 260 }} />
              <div className="tablewrap">
                <table className="restable plain">
                  <thead><tr><th>Zona (Cuenca Alta)</th><th className="num">Nieve nueva 10 días</th><th className="num">Precipitación 10 días (agua)</th><th className="num hide-sm">Puntos</th></tr></thead>
                  <tbody>
                    {w.regions.map((r) => (
                      <tr key={r.name}><td><b>{r.name}</b></td><td className="num">{snow(r.totalSnowCm, u)}</td><td className="num">{water(r.totalPrecMm, u)}</td><td className="num hide-sm">{r.points}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">
                {w.source}, en las {d.data.points} estaciones SNOTEL más altas de cada subcuenca (usando su altura real). Promedio de esas estaciones.
                <b> Nieve nueva</b> = altura de nieve que caería (cm), no es agua; <b>precipitación</b> = agua equivalente (incluye esa nieve). No se suman. Es un pronóstico automático, no el oficial del NWS: después de 5–7 días la incertidumbre es grande.
              </p>
            </>
          ) : (
            <p className="note warn">{d.data.weatherError}</p>
          )}

          <h3>Próximos meses <span className="tag normal">oficial · NOAA CPC</span></h3>
          {d.data.cpc.leads.some((l) => l.season) ? (
            <>
              <div className="tablewrap">
                <table className="restable plain cpc">
                  <thead><tr><th>Zona</th>{d.data.cpc.leads.map((l) => <th key={l.lead}>{seasonEs(l.season)}</th>)}</tr></thead>
                  <tbody>
                    {d.data.regions.map((r) => (
                      <tr key={r.id}>
                        <td><b>{r.name}</b></td>
                        {d.data!.cpc.leads.map((l) => {
                          const p = prcpText(l.prcp[r.id]);
                          return <td key={l.lead}><span className={`tag ${p.k}`}>{p.t}</span><span className="sub">{tempText(l.temp[r.id])}</span></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="note">
                Perspectiva estacional de NOAA (Climate Prediction Center){d.data.cpc.issued ? `, emitida el ${fdate(d.data.cpc.issued)}` : ""}. Cada período de 3 meses se divide en tres categorías que normalmente tienen 33 % de chance cada una:
                "Más húmedo 40–50 %" significa que la chance de quedar en el tercio más lluvioso subió a 40–50 %. <b>No dice cuánto va a llover o nevar</b>, sólo hacia dónde se inclina la probabilidad.
                "Igual probabilidad" = sin señal. La temperatura importa porque decide si cae nieve o lluvia. {d.data.cpc.error ?? ""}{" "}
                <a href="https://www.cpc.ncep.noaa.gov/products/predictions/long_range/seasonal.php" target="_blank" rel="noreferrer">Ver mapas de CPC</a>.
              </p>
            </>
          ) : (
            <p className="note warn">{d.data.cpc.error || "Sin datos de CPC."}</p>
          )}
        </>
      )}
    </section>
  );
}
