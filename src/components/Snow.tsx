import { useMemo } from "react";
import type { Agg, ModelOut, SnowStatus } from "../../netlify/lib/snow";
import { fdate, num, pct, vol, type Units } from "../lib/units";
import EChart, { baseOption, theme } from "./EChart";
import { Months, Next10, useOutlook } from "./Outlook";
import Stations from "./Stations";
import OtherForecasts from "./OtherForecasts";

export type SnowState = { state: "loading" | "ok" | "error"; status: SnowStatus | null; model: ModelOut | null; error?: string };

/** SWE y precipitación vienen en pulgadas: se muestran en mm (métrico) o pulgadas. */
const depth = (inch: number | null | undefined, u: Units) =>
  inch == null || !Number.isFinite(inch) ? "—" : u === "metric" ? `${num(inch * 25.4, inch * 25.4 < 10 ? 1 : 0)} mm` : `${num(inch, 1)} in`;
const depthVal = (inch: number, u: Units) => (u === "metric" ? inch * 25.4 : inch);
const depthUnit = (u: Units) => (u === "metric" ? "mm" : "pulgadas");
const kaf = (v: number | null | undefined) => (v == null ? null : v * 1000); // kac_ft → acre-feet
const temp = (f: number | null | undefined, u: Units) => (f == null ? "—" : u === "metric" ? `${num((f - 32) * 5 / 9, 1)} °C` : `${num(f, 1)} °F`);
const tempDiff = (df: number, u: Units) => { const v = u === "metric" ? (df * 5) / 9 : df; return `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v), 1)} ${u === "metric" ? "°C" : "°F"}`; };
const volNum = (af: number, u: Units) => (u === "metric" ? af * 0.001233481837548 : af);
const volUnitTxt = (u: Units) => (u === "metric" ? "hm³" : "acre-feet");
const localTime = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

function pctClass(p: number | null) {
  if (p == null) return "";
  if (p < 0.7) return "muy-bajo";
  if (p < 0.9) return "bajo";
  if (p <= 1.1) return "normal";
  if (p <= 1.3) return "alto";
  return "muy-alto";
}
const CLS = (p: number | null) => (p == null ? "" : p < 0.7 ? "muy bajo" : p < 0.9 ? "bajo" : p <= 1.1 ? "normal" : p <= 1.3 ? "alto" : "muy alto");

const CONF = {
  alta: { icon: "●", label: "Alta" },
  media: { icon: "●", label: "Media" },
  baja: { icon: "●", label: "Baja" },
  insuficiente: { icon: "●", label: "Insuficiente" },
} as const;

/** Rótulo del tipo de información (no son colores de alerta). */
function Kind({ k }: { k: "obs" | "oficial" | "meteo" | "monitor" }) {
  const L = { obs: "🟢 OBSERVADO", oficial: "🔵 PRONÓSTICO OFICIAL", meteo: "🟣 PRONÓSTICO METEOROLÓGICO", monitor: "🟠 ESTIMACIÓN DEL MONITOR" }[k];
  return <span className={`kind kind-${k}`}>{L}</span>;
}

export default function Snow({ snow, u, onStation }: { snow: SnowState; u: Units; onStation: (id: string) => void }) {
  const t = theme();
  // tolera datos guardados por versiones anteriores (campos faltantes)
  const s = snow.status ? { ...snow.status, forecasts: snow.status.forecasts ?? [], subbasins: snow.status.subbasins ?? [], stations: snow.status.stations ?? [] } : null;
  const m = snow.model && Array.isArray(snow.model.models) && Array.isArray(snow.model.retro) ? snow.model : null;
  const o = useOutlook();

  const seasonOpt = useMemo(() => {
    if (!s || s.light) return null;
    const a = s.season.alta;
    const b = baseOption(t);
    const d = (arr: (number | null)[]) => a.dates.map((x, i) => [x, arr[i] == null ? null : Math.round(depthVal(arr[i]!, u) * 10) / 10]);
    return {
      ...b,
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => (x == null ? "—" : `${num(x, u === "metric" ? 0 : 1)} ${depthUnit(u)}`) },
      yAxis: { ...b.yAxis, name: depthUnit(u), scale: false, min: 0 },
      series: [
        { name: "SWE (nieve en el suelo)", type: "line", data: d(a.swe), symbol: "none", lineStyle: { color: t.water, width: 2.4 }, itemStyle: { color: t.water }, areaStyle: { color: t.waterSoft, opacity: 0.35 } },
        { name: "SWE mediana 1991–2020", type: "line", data: d(a.sweMed), symbol: "none", lineStyle: { color: t.water, type: "dashed", width: 1.2 }, itemStyle: { color: t.water } },
        { name: "Precipitación acumulada", type: "line", data: d(a.prec), symbol: "none", lineStyle: { color: t.out, width: 2 }, itemStyle: { color: t.out } },
        { name: "Precip. mediana 1991–2020", type: "line", data: d(a.precMed), symbol: "none", lineStyle: { color: t.out, type: "dashed", width: 1.2 }, itemStyle: { color: t.out } },
      ],
    };
  }, [s, u]);

  const full = s?.forecasts.filter((x) => x.period[0] === "04-01" && x.period[1] === "07-31") ?? [];
  const seasonFc = full.length ? full[full.length - 1] : null;
  const lastFc = s?.forecasts.length ? s.forecasts[s.forecasts.length - 1] : null;
  const partialFc = lastFc && lastFc !== seasonFc ? lastFc : null;

  const fcOpt = useMemo(() => {
    if (full.length < 2) return null;
    const b = baseOption(t);
    const cv = (x: number | undefined | null) => (x == null ? null : Math.round(volNum(x * 1000, u)));
    return {
      ...b,
      xAxis: { ...b.xAxis, type: "category", data: full.map((x) => fdate(x.publicationDate)) },
      yAxis: { ...b.yAxis, name: volUnitTxt(u), scale: false, min: 0 },
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => (x == null ? "—" : `${num(x)} ${volUnitTxt(u)}`) },
      series: [
        { name: "90 % excedencia (seco)", type: "line", data: full.map((x) => cv(x.values["90"])), lineStyle: { color: t.muted, width: 1 }, itemStyle: { color: t.muted } },
        { name: "50 % (más probable)", type: "line", data: full.map((x) => cv(x.values["50"])), lineStyle: { color: t.water, width: 2.4 }, itemStyle: { color: t.water } },
        { name: "10 % (húmedo)", type: "line", data: full.map((x) => cv(x.values["10"])), lineStyle: { color: t.good, width: 1 }, itemStyle: { color: t.good } },
        { name: "Normal NRCS", type: "line", data: full.map((x) => cv(x.normal)), symbol: "none", lineStyle: { color: t.muted, type: "dashed", width: 1 }, itemStyle: { color: t.muted } },
      ],
    };
  }, [s, u]);

  const retroOpt = useMemo(() => {
    if (!m?.retro.length) return null;
    const b = baseOption(t);
    const cv = (x: number | null) => (x == null ? null : Math.round(volNum(x, u)));
    return {
      ...b,
      xAxis: { ...b.xAxis, type: "category", data: m.retro.map((r) => String(r.wy)) },
      yAxis: { ...b.yAxis, name: `abril–julio, ${volUnitTxt(u)}`, scale: false, min: 0 },
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => (x == null ? "—" : `${num(x)} ${volUnitTxt(u)}`) },
      series: [
        { name: "Real (USBR)", type: "bar", data: m.retro.map((r) => cv(r.actual)), itemStyle: { color: t.waterSoft } },
        { name: "Lo que habría estimado el monitor (sin conocer ese año)", type: "line", data: m.retro.map((r) => cv(r.pred)), lineStyle: { color: t.out, width: 2 }, itemStyle: { color: t.out } },
      ],
    };
  }, [m, u]);

  if (snow.state === "loading") return <section className="card"><h2>Nieve y lluvia</h2><p className="muted">Cargando datos de SNOTEL…</p></section>;

  const A = s?.basins.alta, B = s?.basins.baja;
  const cov = s?.coverage?.alta;
  const covPct = cov && cov.expected ? cov.withData / cov.expected : null;
  const today = s?.today ?? new Date().toISOString().slice(0, 10);
  const seasonOver = today.slice(5) >= "08-01" && today.slice(5) <= "09-30";
  const wy = s?.wy ?? m?.wy;

  return (
    <>
      {/* ---------------------------------------------------------------- encabezado */}
      <section className="card">
        <h2>Nieve, lluvia y aporte a Lake Powell — Cuenca Alta</h2>
        <p className="muted">
          <b>Año hidrológico {wy} — desde el 1 de octubre de {(wy ?? 0) - 1}</b>
          {s && <> · datos al {fdate(s.dataDate ?? s.today)} · SNOTEL · {cov ? `${cov.withData}/${cov.expected} estaciones con dato` : `${A?.n}/${A?.stations} estaciones`} · actualizado {localTime(s.builtAt)}</>}
        </p>
        <p className="kinds"><Kind k="obs" /> lo que se midió · <Kind k="oficial" /> NRCS/CBRFC o NOAA · <Kind k="meteo" /> modelo meteorológico automático · <Kind k="monitor" /> modelo propio, no oficial</p>
        {!s && <p className="note warn">{snow.error || "Todavía no hay datos de SNOTEL."}</p>}
      </section>

      {/* ---------------------------------------------------------------- estado actual */}
      {s && A && (
        <section className="card">
          <div className="toolbar"><h2>❄️ Estado actual</h2><Kind k="obs" /></div>
          <div className="kpis snowk two">
            <div className="kpi">
              <span className="kpi-label">Nieve acumulada (SWE)</span>
              <span className="kpi-val sm">{depth(A.swe, u)}</span>
              <span className="kpi-sub">Mediana para hoy: {depth(A.sweMed, u)}</span>
              <span className="kpi-sub">{A.swePct != null ? <><b>{pct(A.swePct)}</b> de la mediana <span className={`tag ${pctClass(A.swePct)}`}>{CLS(A.swePct)}</span></> : <>% de la mediana: <b>—</b> (no aplica: {today.slice(5) >= "10-01" || today.slice(5) <= "06-30" ? "todavía casi no hay nieve normal para esta fecha" : "fuera de la temporada de nieve"})</>}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Precipitación del año hidrológico</span>
              <span className="kpi-val sm">{depth(A.prec, u)}</span>
              <span className="kpi-sub">Mediana para la fecha: {depth(A.precMed, u)}</span>
              <span className="kpi-sub">{A.precPct != null ? <><b>{pct(A.precPct)}</b> de la mediana <span className={`tag ${pctClass(A.precPct)}`}>{CLS(A.precPct)}</span></> : "% no aplica (recién empieza el año)"}</span>
            </div>
          </div>
          {cov && (
            <p className={`note ${covPct != null && covPct < 0.7 ? "warn" : ""}`}>
              <b>Cobertura:</b> {cov.withData}/{cov.expected} estaciones con dato de los últimos 3 días ({pct(covPct, 1)}) · {cov.stale} desactualizadas · {cov.noObs} sin observación en el período · {cov.error} con error de consulta.
              Una estación sin dato <b>no cuenta como cero</b>: queda fuera del promedio.{covPct != null && covPct < 0.7 ? " Cobertura baja: el valor de la cuenca es menos representativo." : ""}
            </p>
          )}
          <div className="defs">
            <p><b>SWE</b> (equivalente en agua de la nieve) = agua que hay <i>hoy</i> guardada como nieve en el suelo.</p>
            <p><b>Precipitación del año</b> = todo lo que cayó desde el 1-oct (lluvia + nieve), medido como agua en el pluviómetro de cada estación. SNOTEL no separa lluvia de nieve.</p>
            <p><b>No se suman.</b> La nieve que cayó ya está contada en la precipitación; el SWE es la parte de esa nieve que todavía no se derritió. SWE + precipitación <b>no</b> es "agua disponible".</p>
          </div>
          <h3>Temporada {s.wy}: promedio de las estaciones vs. mediana 1991–2020</h3>
          {s.light ? <p className="note warn">Vista rápida (últimos 32 días): el gráfico de toda la temporada aparece cuando corre la actualización automática (cada hora).</p> : seasonOpt && <EChart option={seasonOpt} style={{ height: 300 }} />}

          <h3>Por subcuenca</h3>
          <SubTable s={s} u={u} />
          <p className="note">
            Clasificación estadística propia respecto de la mediana 1991–2020 (&lt; 70 % muy bajo · 70–90 % bajo · 90–110 % normal · 110–130 % alto · &gt; 130 % muy alto). <b>No son alertas oficiales.</b> "—" = sin nieve estacional para comparar (mediana &lt; 25 mm).
          </p>
          <details className="method">
            <summary>¿Cómo se promedian las estaciones?</summary>
            <p>El valor de la cuenca es el <b>promedio simple</b> de las estaciones con dato; el % es <b>Σ valores ÷ Σ medianas</b> de esas mismas estaciones (es el índice de cuenca que usa NRCS). Consecuencias:</p>
            <ul>
              <li><b>Ventaja</b>: transparente, reproducible, igual al método de NRCS; no depende de supuestos.</li>
              <li><b>Limitación</b>: las SNOTEL están en zonas medias-altas y no están repartidas en proporción al área; el promedio <i>no</i> es la lámina de nieve de toda la cuenca. En el %, las estaciones con más nieve pesan más.</li>
              <li><b>Ponderar por altura o por área</b> requeriría curvas hipsométricas por subcuenca y modelos de distribución de nieve (p. ej. SNODAS de NOAA). No se hizo: se mantiene el método simple y se documenta.</li>
              <li>Si faltan estaciones un día, el promedio de ese día se calcula con las que hay (la mediana también, con las mismas): por eso se informa la cobertura.</li>
            </ul>
          </details>
          <p className="src">Fuente: NRCS SNOTEL (AWDB), datos provisorios del año en curso · normales 1991–2020 de NRCS · consultado {localTime(s.builtAt)}.</p>
        </section>
      )}

      {/* ---------------------------------------------------------------- estaciones */}
      {s && (
        <section className="card">
          <div className="toolbar"><h2>📍 Estaciones SNOTEL — nieve en cada punto</h2><Kind k="obs" /></div>
          <p className="muted">Cada fila es una estación automática en la montaña. Tocala para ver toda su temporada (nieve, altura de nieve y precipitación) comparada con su mediana, y el enlace a la ficha oficial de NRCS. También están en el Mapa (capa "Nieve (SNOTEL)").</p>
          <Stations s={s} u={u} onOpen={onStation} />
        </section>
      )}

      {/* ---------------------------------------------------------------- reciente */}
      {s && A && (
        <section className="card">
          <div className="toolbar"><h2>🌧️ Lo reciente</h2><Kind k="obs" /></div>
          <div className="kpis snowk two">
            <Recent label="Últimos 7 días" v={A.p7} avg={A.p7avg} p={A.p7Pct} n={A.n7} u={u} />
            <Recent label="Últimos 30 días" v={A.p30} avg={A.p30avg} p={A.p30Pct} n={A.n30} u={u} />
          </div>
          {A.t7 != null && (
            <div className="kpis snowk two">
              <div className="kpi">
                <span className="kpi-label">Temperatura media del aire, últimos 7 días</span>
                <span className="kpi-val sm">{temp(A.t7, u)}</span>
                <span className="kpi-sub">{A.t7avg != null ? <>Promedio histórico de esas fechas: {temp(A.t7avg, u)} · diferencia <b>{tempDiff(A.t7 - A.t7avg, u)}</b></> : "Sin promedio histórico para comparar"} · {A.nT} estaciones</span>
              </div>
              <div className="kpi">
                <span className="kpi-label">Días con máxima sobre 0 °C (últimos 7)</span>
                <span className="kpi-val sm">{A.warmShare != null ? pct(A.warmShare) : "—"}</span>
                <span className="kpi-sub">Promedio entre estaciones. Con máximas sobre 0 °C la nieve puede empezar a derretirse (depende también del sol y del viento).</span>
              </div>
            </div>
          )}
          <p className="note">
            Se compara <b>la misma ventana de fechas</b> contra su promedio histórico 1991–2020: precipitación caída entre hoy−7 (o −30) y hoy, vs. el promedio de lo que cae en esas mismas fechas.
            Se usa el promedio (no la mediana) porque es aditivo: el promedio de la ventana = promedio acumulado hoy − promedio acumulado al inicio. Cruzando el 1-oct se suma el resto del año anterior + lo del nuevo. % sólo si el promedio de la ventana es ≥ 5 mm.
          </p>
          {B && B.n > 0 && (
            <p className="note">Cuenca Baja (Gila, Salt, Verde, Virgin), sólo referencia: SWE {depth(B.swe, u)} · precipitación del año {depth(B.prec, u)}{B.precPct != null ? ` (${pct(B.precPct)} de la mediana)` : ""} · 7 d {depth(B.p7, u)} · 30 d {depth(B.p30, u)} · {s.coverage?.baja ? `${s.coverage.baja.withData}/${s.coverage.baja.expected}` : B.n} estaciones.</p>
          )}
        </section>
      )}

      {/* ---------------------------------------------------------------- 10 días */}
      <section className="card">
        <div className="toolbar"><h2>🌨️ Próximos 10 días</h2><Kind k="meteo" /></div>
        <p className="muted">Modelo meteorológico automático, no oficial. Es lo que podría caer, no lo que cayó.</p>
        <Next10 o={o} u={u} />
      </section>

      {/* ---------------------------------------------------------------- meses */}
      <section className="card">
        <div className="toolbar"><h2>🗓️ Próximos meses — NOAA CPC</h2><span className="kind kind-oficial">🔵 PERSPECTIVA CLIMÁTICA OFICIAL</span></div>
        <p className="muted">Probabilidades de que el trimestre sea más húmedo, normal o más seco que lo habitual. No es un pronóstico de cantidad de nieve.</p>
        <Months o={o} />
      </section>

      {/* ---------------------------------------------------------------- aporte */}
      <section className="card">
        <h2>💧 Aporte esperado a Lake Powell (abril–julio)</h2>
        <p className="muted">
          <b>Volumen de entrada no regulada a Lake Powell entre el 1-abr y el 31-jul</b>: el agua que llegaría al embalse si no existieran los embalses de aguas arriba (Flaming Gorge, Blue Mesa, Navajo, etc.).
          USBR lo calcula sumando a la entrada medida los cambios de almacenamiento y la evaporación de esos embalses. Es el número que usan USBR, NRCS y CBRFC para el deshielo.
        </p>

        <div className="toolbar"><h3>Observado</h3><Kind k="obs" /></div>
        {m ? (
          <p className="note">
            {m.observedSoFar ? <>Abril–julio {m.wy}: <b>{vol(m.observedSoFar.af, u)}</b> ({m.observedSoFar.days} de 122 días, hasta {fdate(m.observedSoFar.last)}). </> : <>Todavía no empezó el período abril–julio {m.wy}. </>}
            Referencia 1991–2020: mediana {vol(m.climatology.median, u)} · promedio {vol(m.climatology.mean, u)} · p10 {vol(m.climatology.p10, u)} · p90 {vol(m.climatology.p90, u)}
            {m.climatology.min && ` · mínimo ${vol(m.climatology.min.af, u)} (${m.climatology.min.wy})`}{m.climatology.max && ` · máximo ${vol(m.climatology.max.af, u)} (${m.climatology.max.wy})`}.
            <span className="src"> Fuente: USBR HDB, Lake Powell, entrada no regulada diaria (datatype 34, acre-feet), provisoria.</span>
          </p>
        ) : <p className="note">Se calcula junto con la estimación del monitor (una vez por día).</p>}

        <div className="toolbar"><h3>Pronóstico oficial NRCS / CBRFC</h3><Kind k="oficial" /></div>
        {seasonFc ? (
          <>
            <p className="note">
              Punto de pronóstico <b>"Lake Powell Inflow"</b> (NRCS <code>09379900:AZ:USGS</code>), volumen no regulado <b>1-abr a 31-jul</b>, en miles de acre-feet (kaf) convertidos.
              Última publicación para ese período: <b>{fdate(seasonFc.publicationDate)}</b>{seasonFc.issueDate ? ` (emitida ${seasonFc.issueDate.slice(0, 10)})` : ""}.
              {seasonOver && m?.observedSoFar && m.observedSoFar.days >= 118 && <> Temporada {m.wy} cerrada: se observó <b>{vol(m.observedSoFar.af, u)}</b>.</>}
            </p>
            <div className="scen">
              <Scen label="Seco — 90 % de excedencia" v={kaf(seasonFc.values["90"])} normal={kaf(seasonFc.normal)} of="de la normal NRCS" u={u} tone="bad" />
              <Scen label="Central — 50 % de excedencia" v={kaf(seasonFc.values["50"])} normal={kaf(seasonFc.normal)} of="de la normal NRCS" u={u} tone="water" big />
              <Scen label="Húmedo — 10 % de excedencia" v={kaf(seasonFc.values["10"])} normal={kaf(seasonFc.normal)} of="de la normal NRCS" u={u} tone="good" />
            </div>
            <p className="note">
              <b>Qué significa "90 % de excedencia"</b>: hay 90 % de probabilidad de que el volumen real <b>supere</b> ese valor (por eso es el escenario seco). No es "90 % de probabilidad de que ocurra ese número".
              El 50 % es la mediana del pronóstico. Normal NRCS del período: {vol(kaf(seasonFc.normal), u)} (normal 1991–2020 que publica NRCS junto con el pronóstico).
            </p>
            {partialFc && (
              <p className="note warn">
                Hay una publicación posterior ({fdate(partialFc.publicationDate)}) para otro período: <b>{partialFc.period[0].split("-").reverse().join("/")} a {partialFc.period[1].split("-").reverse().join("/")}</b> (sólo el volumen que faltaba) — 90 % {vol(kaf(partialFc.values["90"]), u)} · 50 % {vol(kaf(partialFc.values["50"]), u)} · 10 % {vol(kaf(partialFc.values["10"]), u)} · normal {vol(kaf(partialFc.normal), u)}. No es comparable con el total abril–julio.
              </p>
            )}
            <h4 className="sub-h">Cómo fue cambiando el pronóstico</h4>
            {fcOpt && <EChart option={fcOpt} style={{ height: 230 }} />}
            <div className="tablewrap">
              <table className="restable plain">
                <thead><tr><th>Publicación</th><th>Período</th><th className="num">90 %</th><th className="num">70 %</th><th className="num">50 %</th><th className="num">30 %</th><th className="num">10 %</th><th className="num">Normal</th></tr></thead>
                <tbody>
                  {s!.forecasts.map((f) => (
                    <tr key={f.publicationDate + f.period.join()}>
                      <td>{fdate(f.publicationDate)}</td><td>{f.period[0].split("-").reverse().join("/")}–{f.period[1].split("-").reverse().join("/")}</td>
                      {["90", "70", "50", "30", "10"].map((k) => <td key={k} className="num">{f.values[k] != null ? vol(kaf(f.values[k]), u) : "—"}</td>)}
                      <td className="num">{vol(kaf(f.normal), u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="src">Fuente: NRCS AWDB /forecasts (pronóstico coordinado NRCS–CBRFC), unidad original kac_ft · historial tal como lo devuelve la fuente para el año hidrológico {s?.wy}.</p>
          </>
        ) : (
          <p className="note">{s?.forecastError ?? `Todavía no hay pronóstico oficial para el año hidrológico ${s?.wy ?? ""}: NRCS y CBRFC lo publican de enero a junio.`}</p>
        )}
      </section>

      <section className="card">
        <div className="toolbar"><h2>💧 Pronósticos oficiales para los otros embalses y ríos</h2><Kind k="oficial" /></div>
        <p className="muted">Flaming Gorge, Blue Mesa, Navajo, McPhee, Granby, Dillon, Fontenelle y el resto de los puntos donde NRCS y CBRFC pronostican el aporte de la temporada.</p>
        <OtherForecasts u={u} />
      </section>

      {/* ---------------------------------------------------------------- estimación */}
      <section className="card">
        <div className="toolbar"><h2>🔬 Estimación del monitor</h2><Kind k="monitor" /></div>
        {m ? <Estimate m={m} u={u} retroOpt={retroOpt} /> : <p className="note">Se calcula automáticamente una vez por día (la primera, dentro de la hora siguiente a publicar). Todavía no corrió.</p>}
      </section>

      <section className="card">
        <h2>De la nieve al embalse: qué se puede afirmar</h2>
        <ol className="chain">
          <li><b>Nieve (SWE)</b> — medida en SNOTEL. <i>Observado.</i></li>
          <li><b>Deshielo → escurrimiento</b> — el monitor <b>no</b> modela el deshielo físicamente (energía, suelo, sublimación). Sólo usa la relación <b>estadística</b> histórica entre nieve/precipitación en una fecha y el volumen abril–julio. Es correlación, no causalidad cuantitativa.</li>
          <li><b>Escurrimiento → entrada a Powell</b> — el pronóstico oficial y la estimación son de entrada <b>no regulada</b>. La entrada real (regulada) depende además de lo que retengan o suelten Flaming Gorge, Blue Mesa, Navajo y otros.</li>
          <li><b>Entrada → almacenamiento de Powell</b> — balance de masa: cambio de volumen = entrada − salida (liberación de Glen Canyon) − evaporación. La salida la fija USBR según sus reglas de operación. Ver pestañas Embalses y Entradas y salidas.</li>
        </ol>
      </section>
    </>
  );
}

function SubTable({ s, u }: { s: SnowStatus; u: Units }) {
  const groups: ["alta" | "baja", string][] = [["alta", "Cuenca Alta (aporta a Powell)"], ["baja", "Cuenca Baja (referencia)"]];
  return (
    <div className="tablewrap">
      <table className="restable plain">
        <thead><tr><th>Subcuenca</th><th className="num">Estaciones con dato</th><th className="num">SWE</th><th className="num">% mediana</th><th className="num">Precip. año</th><th className="num">% mediana</th><th className="num hide-sm">7 d</th><th className="num hide-sm">30 d</th></tr></thead>
        <tbody>
          {groups.map(([b, label]) => {
            const rows = s.subbasins.filter((x) => x.basin === b && x.stations > 0);
            if (!rows.length) return null;
            return [
              <tr key={b} className="grp"><td colSpan={8}>{label}</td></tr>,
              ...rows.map((x: Agg & { name: string }) => (
                <tr key={b + x.name}>
                  <td><b>{x.name}</b></td>
                  <td className="num">{x.n}/{x.stations}</td>
                  <td className="num">{depth(x.swe, u)}</td>
                  <td className="num">{x.swePct != null ? <span className={`tag ${pctClass(x.swePct)}`}>{pct(x.swePct)}</span> : "—"}</td>
                  <td className="num">{depth(x.prec, u)}</td>
                  <td className="num">{x.precPct != null ? <span className={`tag ${pctClass(x.precPct)}`}>{pct(x.precPct)}</span> : "—"}</td>
                  <td className="num hide-sm">{depth(x.p7, u)}</td>
                  <td className="num hide-sm">{depth(x.p30, u)}</td>
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function Recent({ label, v, avg, p, n, u }: { label: string; v: number | null; avg: number | null; p: number | null; n: number; u: Units }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-val sm">{depth(v, u)}</span>
      <span className="kpi-sub">Promedio de esas mismas fechas: {depth(avg, u)}</span>
      <span className="kpi-sub">{p != null ? <><b>{pct(p)}</b> del promedio de esas fechas</> : "% no aplica (el promedio de la ventana es muy chico)"} · {n} estaciones</span>
    </div>
  );
}

function Estimate({ m, u, retroOpt }: { m: ModelOut; u: Units; retroOpt: any }) {
  const ch = m.models.find((x) => x.name === m.chosen) || null;
  return (
    <>
      <p className="muted">
        Calculada el {fdate(m.today)} · fecha de comparación {m.md.split("-").reverse().join("/")} de cada año · {m.retro.length} años con dato · índice con {m.stationsUsed} estaciones SNOTEL
        {m.inSeason ? ` (${m.stationsNow} con dato hoy)` : ""}. No es un pronóstico oficial.
      </p>
      <div className={`conf conf-${m.confidence.level}`}>
        <b><span className={`dot dot-${m.confidence.level}`}>{CONF[m.confidence.level].icon}</span> Confianza: {CONF[m.confidence.level].label}</b>
        <ul>{m.confidence.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </div>
      {m.estimate ? (
        <>
          <div className="scen">
            <Scen label="Escenario seco (≈ 10 % inferior)" v={m.estimate.low} normal={m.climatology.median} u={u} tone="bad" />
            <Scen label="Estimación central" v={m.estimate.central} normal={m.climatology.median} u={u} tone="water" big />
            <Scen label="Escenario húmedo (≈ 10 % superior)" v={m.estimate.high} normal={m.climatology.median} u={u} tone="good" />
          </div>
          <p className="note">Rango: {vol(m.estimate.low, u)} – {vol(m.estimate.high, u)} (central ± 1,28 × error de validación). Método: {m.chosen}{m.analogYears ? ` · años análogos: ${m.analogYears.join(", ")}` : ""}.</p>
        </>
      ) : (
        <p className="note warn">{m.reason}</p>
      )}

      <h3>Validación retrospectiva al {m.md.split("-").reverse().join("/")}</h3>
      <p className="note">Cada año se estima con un modelo ajustado <b>sin ese año</b> y se compara con lo que realmente entró. Así se ve si el método aporta información o no.</p>
      <div className="tablewrap">
        <table className="restable plain">
          <thead><tr><th>Método</th><th className="num">R² validación</th><th className="num">Error medio (abs.)</th><th className="num">Error relativo</th><th className="num">Sesgo</th><th className="num hide-sm">Dispersión</th><th className="num hide-sm">Años</th></tr></thead>
          <tbody>
            {m.models.map((x) => (
              <tr key={x.name}>
                <td><b>{x.name}</b>{m.chosen === x.name && <span className="tag normal">elegido</span>}<span className="sub">{x.kind}{x.r != null ? ` · r = ${num(x.r, 2)}` : ""}</span></td>
                <td className="num">{x.looR2 != null ? num(x.looR2, 2) : "—"}</td>
                <td className="num">{x.skill ? vol(x.skill.mae, u) : "—"}</td>
                <td className="num">{x.skill && Number.isFinite(x.skill.mape) ? pct(x.skill.mape) : "—"}</td>
                <td className="num">{x.skill ? vol(x.skill.bias, u, true) : "—"}</td>
                <td className="num hide-sm">{x.skill ? vol(x.skill.sdErr, u) : "—"}</td>
                <td className="num hide-sm">{x.skill?.n ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ch?.skill?.coverage80 != null && <p className="note">Cobertura del rango (método elegido): el valor real cayó dentro del rango seco–húmedo en <b>{pct(ch.skill.coverage80)}</b> de los años (se espera ≈ 80 %).</p>}
      {retroOpt && <EChart option={retroOpt} style={{ height: 280 }} />}
      <details className="method">
        <summary>Metodología y reglas de confianza</summary>
        <h4>Qué entra y qué no</h4>
        <ul>
          <li><b>Estado actual</b>: SWE (nieve guardada). <b>Entrada acumulada</b>: precipitación del año. Se prueban por separado y juntos; en la regresión conjunta no se suman: cada una tiene su coeficiente, pero como están muy correlacionadas (la nieve es parte de la precipitación) los coeficientes pueden ser inestables. Por eso sólo se elige si <b>valida mejor</b> fuera de muestra.</li>
          <li><b>Pronósticos futuros</b> (10 días, NOAA CPC): no entran en el modelo, para no mezclar lo medido con lo pronosticado.</li>
          <li><b>Humedad de la cuenca</b>: no hay un dato directo gratuito y continuo; se prueba como aproximación el aporte abril–julio del año anterior.</li>
          <li><b>Temperatura</b>: no entra (no hay una serie histórica homogénea en la misma fuente). El pronóstico oficial sí la considera.</li>
          <li><b>Estado inicial de los embalses</b>: no aplica, el volumen es no regulado.</li>
        </ul>
        <h4>Métodos</h4>
        <ol>
          <li>Índice por año = promedio entre estaciones de (valor ese año en esa fecha ÷ promedio de esa estación en esa fecha). Estaciones con dato en ≥ 80 % de los años.</li>
          <li><b>Regresiones lineales</b>: SWE; precipitación; SWE + precipitación; SWE + aporte del año anterior.</li>
          <li><b>Años análogos</b>: los 5 años más parecidos en SWE y precipitación (variables estandarizadas); la estimación es el promedio de su aporte.</li>
          <li>Se elige el de menor error cuadrático fuera de muestra. Rango = central ± 1,2816 × ese error, nunca negativo.</li>
        </ol>
        <h4>Confianza</h4>
        <ul>
          <li>Insuficiente: fuera de 1-oct → 1-abr, menos del 50 % de las estaciones del índice con dato hoy, o R² de validación &lt; 0,30.</li>
          <li>Si no, puntos: cobertura ≥ 80 % (+1); R² validación ≥ 0,7 (+2) o ≥ 0,5 (+1); dentro del rango histórico (+1) o extrapolación (−1); ≤ 45 días al 1-abr (+1), &gt; 90 días (−1); menos de 25 años (−1). Alta ≥ 4 · Media 2–3 · Baja ≤ 1.</li>
        </ul>
      </details>
    </>
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
