import { useMemo } from "react";
import type { ModelOut, SnowStatus } from "../../netlify/lib/snow";
import { fdate, num, pct, vol, type Units } from "../lib/units";
import EChart, { baseOption, theme } from "./EChart";

export type SnowState = { state: "loading" | "ok" | "error"; status: SnowStatus | null; model: ModelOut | null; error?: string };

/** SWE y precipitación vienen en pulgadas: se muestran en mm (métrico) o pulgadas. */
const depth = (inch: number | null | undefined, u: Units) =>
  inch == null || !Number.isFinite(inch) ? "—" : u === "metric" ? `${num(inch * 25.4, inch * 25.4 < 10 ? 1 : 0)} mm` : `${num(inch, 1)} in`;
const depthVal = (inch: number, u: Units) => (u === "metric" ? inch * 25.4 : inch);
const depthUnit = (u: Units) => (u === "metric" ? "mm" : "pulgadas");
const kaf = (v: number | null | undefined) => (v == null ? null : v * 1000); // kac_ft → acre-feet

function pctClass(p: number | null) {
  if (p == null) return "";
  if (p < 0.7) return "muy-bajo";
  if (p < 0.9) return "bajo";
  if (p <= 1.1) return "normal";
  if (p <= 1.3) return "alto";
  return "muy-alto";
}

const CONF = {
  alta: { icon: "🟢", label: "Alta" },
  media: { icon: "🟡", label: "Media" },
  baja: { icon: "🟠", label: "Baja" },
  insuficiente: { icon: "🔴", label: "Insuficiente" },
} as const;

export default function Snow({ snow, u }: { snow: SnowState; u: Units }) {
  const t = theme();
  const s = snow.status, m = snow.model;

  const seasonOpt = useMemo(() => {
    if (!s) return null;
    const a = s.season.alta;
    const b = baseOption(t);
    const d = (arr: (number | null)[]) => a.dates.map((x, i) => [x, arr[i] == null ? null : Math.round(depthVal(arr[i]!, u) * 10) / 10]);
    return {
      ...b,
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => (x == null ? "—" : `${num(x, u === "metric" ? 0 : 1)} ${depthUnit(u)}`) },
      yAxis: { ...b.yAxis, name: depthUnit(u), scale: false, min: 0 },
      series: [
        { name: "SWE (nieve acumulada)", type: "line", data: d(a.swe), symbol: "none", lineStyle: { color: t.water, width: 2.4 }, itemStyle: { color: t.water }, areaStyle: { color: t.waterSoft, opacity: 0.35 } },
        { name: "SWE mediana 1991–2020", type: "line", data: d(a.sweMed), symbol: "none", lineStyle: { color: t.water, type: "dashed", width: 1.2 }, itemStyle: { color: t.water } },
        { name: "Precipitación acumulada", type: "line", data: d(a.prec), symbol: "none", lineStyle: { color: t.out, width: 2 }, itemStyle: { color: t.out } },
        { name: "Precip. mediana 1991–2020", type: "line", data: d(a.precMed), symbol: "none", lineStyle: { color: t.out, type: "dashed", width: 1.2 }, itemStyle: { color: t.out } },
      ],
    };
  }, [s, u]);

  const fcOpt = useMemo(() => {
    if (!s?.forecasts.length) return null;
    const b = baseOption(t);
    // sólo pronósticos del mismo período (abril–julio); los de mayo y junio cubren menos meses y no son comparables
    const f = s.forecasts.filter((x) => x.values["50"] != null && x.period[0] === "04-01" && x.period[1] === "07-31");
    if (f.length < 2) return null;
    const cv = (x: number | undefined) => (x == null ? null : Math.round(depthless(kaf(x)!, u)));
    return {
      ...b,
      xAxis: { ...b.xAxis, type: "category", data: f.map((x) => fdate(x.publicationDate)) },
      yAxis: { ...b.yAxis, name: u === "metric" ? "hm³" : "acre-feet", scale: false, min: 0 },
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => (x == null ? "—" : `${num(x)} ${u === "metric" ? "hm³" : "af"}`) },
      series: [
        { name: "90 % (seco)", type: "line", data: f.map((x) => cv(x.values["90"])), lineStyle: { color: t.bad, width: 1 }, itemStyle: { color: t.bad } },
        { name: "50 % (más probable)", type: "line", data: f.map((x) => cv(x.values["50"])), lineStyle: { color: t.water, width: 2.4 }, itemStyle: { color: t.water } },
        { name: "10 % (húmedo)", type: "line", data: f.map((x) => cv(x.values["10"])), lineStyle: { color: t.good, width: 1 }, itemStyle: { color: t.good } },
        { name: "Normal NRCS", type: "line", data: f.map((x) => cv(x.normal ?? undefined)), symbol: "none", lineStyle: { color: t.muted, type: "dashed", width: 1 }, itemStyle: { color: t.muted } },
      ],
    };
  }, [s, u]);

  const scatterOpt = useMemo(() => {
    if (!m?.chosen) return null;
    const ch = m.models.find((x) => x.name === m.chosen)!;
    if (ch.predictors.length !== 1) return null;
    const key = ch.predictors[0] as "sweIdx" | "precIdx";
    const pts = m.years.filter((y) => y[key] != null && y.runoff != null).map((y) => [Math.round(y[key]! * 100), Math.round(depthless(y.runoff!, u)), y.wy]);
    const b = baseOption(t);
    const cur = m.current[key];
    return {
      ...b,
      tooltip: { trigger: "item", backgroundColor: t.bg, borderColor: t.line, textStyle: { color: t.ink }, formatter: (p: any) => `${p.data[2]}: índice ${p.data[0]} % · ${num(p.data[1])} ${u === "metric" ? "hm³" : "af"}` },
      xAxis: { type: "value", name: `${key === "sweIdx" ? "SWE" : "Precipitación"} al ${m.md.split("-").reverse().join("/")} (% del promedio de cada estación)`, nameLocation: "middle", nameGap: 26, axisLabel: { color: t.muted }, nameTextStyle: { color: t.muted }, splitLine: { show: false }, scale: true },
      yAxis: { ...b.yAxis, name: u === "metric" ? "abril–julio, hm³" : "abril–julio, af", scale: false, min: 0 },
      grid: { ...b.grid, bottom: 44 },
      series: [
        { type: "scatter", data: pts, symbolSize: 7, itemStyle: { color: t.water } },
        ...(cur != null && m.inSeason ? [{ type: "line", data: [], markLine: { symbol: "none", label: { formatter: `hoy ${Math.round(cur * 100)} %`, color: t.out }, lineStyle: { color: t.out, type: "dashed" }, data: [{ xAxis: Math.round(cur * 100) }] } }] : []),
      ],
    };
  }, [m, u]);

  if (snow.state === "loading") return <section className="card"><h2>Nieve y lluvia</h2><p className="muted">Cargando datos de SNOTEL…</p></section>;
  if (!s && !m) return <section className="card"><h2>Nieve y lluvia</h2><p className="note warn">{snow.error || "Sin datos todavía."}</p></section>;

  const A = s?.basins.alta, B = s?.basins.baja;
  const latest = s?.forecasts.length ? s.forecasts[s.forecasts.length - 1] : null;
  const winter = s ? s.today.slice(5) >= "10-01" || s.today.slice(5) <= "06-30" : false;

  return (
    <>
      {s && (
        <section className="card">
          <div className="toolbar">
            <h2>Nieve y precipitación — Cuenca Alta (aporta a Lake Powell)</h2>
            <span className="muted">Año hidrológico {s.wy} (desde el {fdate(s.wyStart)}) · SNOTEL, {A?.n}/{A?.stations} estaciones con dato · {fdate(s.today)}</span>
          </div>
          <div className="kpis snowk">
            <Kpi title="Nieve acumulada (SWE)" val={depth(A?.swe, u)} sub={A?.swePct != null ? <>{pct(A.swePct)} de la mediana para la fecha <span className={`tag ${pctClass(A.swePct)}`}>{pct(A.swePct)}</span></> : <>mediana para hoy: {depth(A?.sweMed, u)} — {winter ? "todavía poca nieve estacional" : "fuera de la temporada de nieve"}: el % no aplica</>} />
            <Kpi title="Precipitación del año hidrológico" val={depth(A?.prec, u)} sub={A?.precPct != null ? <>{pct(A.precPct)} de la mediana para la fecha</> : <>mediana: {depth(A?.precMed, u)} (recién empieza el año: % no aplica)</>} />
            <Kpi title="Precipitación últimos 7 días" val={depth(A?.p7, u)} sub={A?.p7Pct != null ? <>{pct(A.p7Pct)} del promedio de esas fechas</> : <>promedio: {depth(A?.p7avg, u)} (muy poco para calcular %)</>} />
            <Kpi title="Precipitación últimos 30 días" val={depth(A?.p30, u)} sub={A?.p30Pct != null ? <>{pct(A.p30Pct)} del promedio de esas fechas</> : <>promedio: {depth(A?.p30avg, u)}</>} />
          </div>
          {B && B.n > 0 && (
            <p className="note">Cuenca Baja (Gila, Salt, Verde, Virgin): SWE {depth(B.swe, u)}{B.swePct != null ? ` (${pct(B.swePct)} de la mediana)` : ""} · precipitación del año {depth(B.prec, u)}{B.precPct != null ? ` (${pct(B.precPct)} de la mediana)` : ""} · {B.n}/{B.stations} estaciones.</p>
          )}
          <h3>Temporada {s.wy}: promedio de las estaciones vs. mediana 1991–2020</h3>
          {s.light ? (
            <p className="note warn">Vista rápida (últimos 32 días): el gráfico de toda la temporada aparece cuando corre la actualización automática, dentro de la próxima hora.</p>
          ) : (
            seasonOpt && <EChart option={seasonOpt} style={{ height: 300 }} />
          )}
          <p className="note">
            <b>SWE</b> (equivalente en agua de la nieve) = agua que hay hoy guardada como nieve en el suelo. <b>Precipitación</b> = todo lo que cayó desde el 1-oct
            medido en el pluviómetro (lluvia + nieve derretida, en agua equivalente); SNOTEL no separa lluvia de nieve. No se suman: la nieve que cayó está incluida en ambas.
            Promedio simple entre estaciones con dato ese día; la mediana es la de esas mismas estaciones.
          </p>
          <h3>Por subcuenca</h3>
          <div className="tablewrap">
            <table className="restable plain">
              <thead><tr><th>Subcuenca</th><th className="num">Estaciones</th><th className="num">SWE</th><th className="num">% mediana</th><th className="num">Precip. año</th><th className="num">% mediana</th><th className="num hide-sm">7 d</th><th className="num hide-sm">30 d</th></tr></thead>
              <tbody>
                {s.subbasins.filter((x) => x.stations > 0).map((x) => (
                  <tr key={x.basin + x.name}>
                    <td><b>{x.name}</b><span className="sub">Cuenca {x.basin}</span></td>
                    <td className="num">{x.n}/{x.stations}</td>
                    <td className="num">{depth(x.swe, u)}</td>
                    <td className="num">{x.swePct != null ? <span className={`tag ${pctClass(x.swePct)}`}>{pct(x.swePct)}</span> : "—"}</td>
                    <td className="num">{depth(x.prec, u)}</td>
                    <td className="num">{pct(x.precPct)}</td>
                    <td className="num hide-sm">{depth(x.p7, u)}</td>
                    <td className="num hide-sm">{depth(x.p30, u)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="note">Colores: clasificación estadística propia respecto de la mediana 1991–2020 (&lt; 70 % muy bajo · 70–90 % bajo · 90–110 % normal · 110–130 % alto · &gt; 130 % muy alto). No son alertas oficiales. "—" = sin nieve estacional para comparar.</p>
        </section>
      )}

      <section className="card">
        <h2>Aporte de primavera–verano a Lake Powell (abril–julio)</h2>
        <p className="muted">Volumen de entrada <b>no regulada</b> a Lake Powell entre el 1-abr y el 31-jul: lo que llegaría si no hubiera embalses aguas arriba. Es el número que usan USBR, NRCS y CBRFC para describir el deshielo.</p>

        <h3>Pronóstico oficial NRCS / CBRFC</h3>
        {latest ? (
          <>
            <div className="scen">
              <Scen label="Seco (90 % de probabilidad de superarlo)" v={kaf(latest.values["90"])} normal={kaf(latest.normal)} u={u} tone="bad" of="de la normal NRCS" />
              <Scen label="Más probable (50 %)" v={kaf(latest.values["50"])} normal={kaf(latest.normal)} u={u} tone="water" big of="de la normal NRCS" />
              <Scen label="Húmedo (10 %)" v={kaf(latest.values["10"])} normal={kaf(latest.normal)} u={u} tone="good" of="de la normal NRCS" />
            </div>
            <p className="note">Publicación del {fdate(latest.publicationDate)} · período {latest.period[0].replace("-", "/")}–{latest.period[1].replace("-", "/")} · normal NRCS {vol(kaf(latest.normal), u)}. Oficial: <a href="https://www.cbrfc.noaa.gov/" target="_blank" rel="noreferrer">CBRFC</a> / <a href="https://www.nrcs.usda.gov/resources/data-and-reports/water-supply-forecasting" target="_blank" rel="noreferrer">NRCS</a>.</p>
            {fcOpt && <><h4 className="sub-h">Cómo fue cambiando el pronóstico abril–julio en la temporada</h4><EChart option={fcOpt} style={{ height: 240 }} /></>}
          </>
        ) : (
          <p className="note">{s?.forecastError ?? `Todavía no hay pronóstico oficial para el año hidrológico ${s?.wy ?? ""}: NRCS y CBRFC lo publican de enero a junio.`}</p>
        )}

        {m?.observedSoFar && m.observedSoFar.days > 0 && (
          <p className="note">
            Observado abril–julio {m.wy}: {vol(m.observedSoFar.af, u)} en {m.observedSoFar.days} de 122 días (hasta {fdate(m.observedSoFar.last)}; USBR, provisorio).
            {m.climatology.median != null && ` Mediana 1991–2020: ${vol(m.climatology.median, u)}.`}
          </p>
        )}

        <h3>Estimación del monitor <span className="tag">no oficial</span></h3>
        {m ? (
          <>
            <div className={`conf conf-${m.confidence.level}`}>
              <b>{CONF[m.confidence.level].icon} Confianza: {CONF[m.confidence.level].label}</b>
              <ul>{m.confidence.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
            {m.estimate ? (
              <div className="scen">
                <Scen label="Escenario seco (≈ 10 % inferior)" v={m.estimate.low} normal={m.climatology.median} u={u} tone="bad" />
                <Scen label="Escenario central" v={m.estimate.central} normal={m.climatology.median} u={u} tone="water" big />
                <Scen label="Escenario húmedo (≈ 10 % superior)" v={m.estimate.high} normal={m.climatology.median} u={u} tone="good" />
              </div>
            ) : (
              <p className="note warn">{m.reason}</p>
            )}
            <p className="note">
              Comparación: mediana 1991–2020 {vol(m.climatology.median, u)} · promedio {vol(m.climatology.mean, u)} · percentil 10 {vol(m.climatology.p10, u)} · percentil 90 {vol(m.climatology.p90, u)}
              {m.climatology.min && ` · mínimo ${vol(m.climatology.min.af, u)} (${m.climatology.min.wy})`}{m.climatology.max && ` · máximo ${vol(m.climatology.max.af, u)} (${m.climatology.max.wy})`} ({m.climatology.n} años).
            </p>
            <h3>Relación histórica al {m.md.split("-").reverse().join("/")} ({m.years.filter((y) => y.runoff != null).length} años, {m.stationsUsed} estaciones en el índice)</h3>
            <div className="tablewrap">
              <table className="restable plain">
                <thead><tr><th>Variable</th><th className="num">r</th><th className="num">R² (ajuste)</th><th className="num">R² validación</th><th className="num">Error típico</th><th className="num">Años</th></tr></thead>
                <tbody>
                  {m.models.map((x) => (
                    <tr key={x.name}>
                      <td><b>{x.name}</b>{m.chosen === x.name && <span className="tag normal">elegido</span>}</td>
                      <td className="num">{x.r != null ? num(x.r, 2) : "—"}</td>
                      <td className="num">{x.fit ? num(x.fit.r2, 2) : "—"}</td>
                      <td className="num">{x.fit ? num(x.fit.looR2, 2) : "—"}</td>
                      <td className="num">{x.fit ? vol(x.fit.looRmse, u) : "—"}</td>
                      <td className="num">{x.fit?.n ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {scatterOpt && <EChart option={scatterOpt} style={{ height: 300 }} />}
          </>
        ) : (
          <p className="note">La estimación se calcula automáticamente una vez por día (la primera, dentro de la hora siguiente a publicar). Todavía no corrió.</p>
        )}
        <details className="method">
          <summary>Metodología, temporadas y reglas de confianza</summary>
          <h4>Temporadas</h4>
          <ul>
            <li><b>Año hidrológico (water year)</b>: 1-oct → 30-sep, nombrado por el año en que termina (WY{s?.wy ?? 2026} = 1-oct-{(s?.wy ?? 2026) - 1} a 30-sep-{s?.wy ?? 2026}). Lo usan USGS, NRCS y USBR. La precipitación acumulada de SNOTEL vuelve a cero cada 1-oct.</li>
            <li><b>Temporada de acumulación de nieve</b>: aproximadamente oct → abr (el pico mediano en la Cuenca Alta suele ser entre fines de marzo y principios de mayo según la altura).</li>
            <li><b>Temporada de deshielo / escurrimiento</b>: abr → jul. El pronóstico oficial de Powell se expresa como volumen abril–julio.</li>
            <li>Las fechas de NRCS y USBR son fechas locales de cada estación; se comparan como fechas, sin convertir zonas horarias.</li>
          </ul>
          <h4>Estimación del monitor (reproducible)</h4>
          <ol>
            <li>Se toma la fecha de hoy (día y mes) si estamos entre el 1-oct y el 1-abr; fuera de ese período se muestra la relación al 1-abr sólo como referencia.</li>
            <li>Para cada año 1991 → último completo, se lee el SWE y la precipitación acumulada de cada SNOTEL de la Cuenca Alta en esa misma fecha.</li>
            <li>Índice del año = promedio entre estaciones de (valor del año ÷ promedio histórico de esa estación en esa fecha). Sólo estaciones con dato en ≥ 80 % de los años y promedio ≥ 0,5 pulgadas.</li>
            <li>Se ajustan tres regresiones lineales contra el volumen abril–julio no regulado de Powell (USBR): sólo SWE, sólo precipitación, y SWE + precipitación. Se elige la de menor error fuera de muestra (validación dejando un año afuera).</li>
            <li>Escenarios: central ± 1,28 × error de validación (≈ rango 10 %–90 % si los errores fueran normales). Nunca negativo.</li>
            <li>No se usan temperatura, humedad del suelo ni pronósticos meteorológicos (el pronóstico oficial sí los considera): por eso el oficial manda. El estado de los embalses no entra porque el volumen es "no regulado".</li>
          </ol>
          <h4>Confianza</h4>
          <ul>
            <li>🔴 Insuficiente: fuera de 1-oct → 1-abr, menos del 50 % de las estaciones del índice reportando hoy, o R² de validación &lt; 0,30.</li>
            <li>Si no: suma de puntos — cobertura ≥ 80 % (+1); R² de validación ≥ 0,7 (+2) o ≥ 0,5 (+1); índice actual dentro del rango histórico (+1, si no −1: extrapolación); ≤ 45 días al 1-abr (+1), &gt; 90 días (−1); menos de 25 años (−1).</li>
            <li>🟢 Alta ≥ 4 · 🟡 Media 2–3 · 🟠 Baja ≤ 1.</li>
          </ul>
          <h4>Unidades</h4>
          <p>1 pulgada = 25,4 mm · 1 acre-foot = 1.233,5 m³ · 1 kaf = 1.000 acre-feet = 1,2335 hm³ · 1 cfs durante un día = 1,9835 acre-feet.</p>
        </details>
      </section>
    </>
  );
}

function depthless(af: number, u: Units) {
  return u === "metric" ? af * 0.001233481837548 : af;
}

function Kpi({ title, val, sub }: { title: string; val: string; sub: React.ReactNode }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{title}</span>
      <span className="kpi-val sm">{val}</span>
      <span className="kpi-sub">{sub}</span>
    </div>
  );
}

function Scen({ label, v, normal, u, tone, big, of = "de la mediana 1991–2020" }: { label: string; v: number | null | undefined; normal: number | null | undefined; u: Units; tone: "bad" | "water" | "good"; big?: boolean; of?: string }) {
  return (
    <div className={`scen-i ${tone}${big ? " big" : ""}`}>
      <span>{label}</span>
      <b>{vol(v ?? null, u)}</b>
      <em>{v != null && normal ? `${pct(v / normal)} ${of}` : ""}</em>
    </div>
  );
}
