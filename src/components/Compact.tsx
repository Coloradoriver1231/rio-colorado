import { useEffect, useMemo, useState } from "react";
import { fdate, num, vol, type Units } from "../lib/units";
import EChart, { baseOption, theme } from "./EChart";

type Data = {
  builtAt: string; api: string;
  years: { wy: number; lees: number | null; paria: number | null; total: number | null; complete: boolean }[];
  rolling: { wy: number; af: number }[];
  current: { wy: number; af: number; days: number; to: string } | null;
  thresholds: { compact: number; withMexico: number };
};

/** Indicador del Compact de 1922: caudal en Lee Ferry, suma móvil de 10 años (cálculo del monitor con datos USGS). */
export default function Compact({ u }: { u: Units }) {
  const [d, setD] = useState<{ state: "loading" | "ok" | "error"; data?: Data; error?: string }>({ state: "loading" });
  useEffect(() => {
    let alive = true;
    fetch(`/api/compact?b=${Math.floor(Date.now() / 3600e3)}`)
      .then(async (r) => { const b = await r.json().catch(() => null); if (alive) setD(r.ok && b ? { state: "ok", data: b } : { state: "error", error: b?.error || `HTTP ${r.status}` }); })
      .catch((e) => alive && setD({ state: "error", error: String(e?.message || e) }));
    return () => { alive = false; };
  }, []);
  const t = theme();
  const x = d.data;
  const maf = (af: number) => Math.round((u === "metric" ? af * 0.001233481837548 / 1000 : af / 1e6) * 100) / 100; // km³ o MAF
  const unit = u === "metric" ? "km³" : "MAF";
  const opt = useMemo(() => {
    if (!x) return null;
    const b = baseOption(t);
    const yrs = x.years.filter((y) => y.wy >= 2000);
    const roll = new Map(x.rolling.map((r) => [r.wy, r.af]));
    return {
      ...b,
      xAxis: { ...b.xAxis, type: "category", data: yrs.map((y) => String(y.wy)) },
      yAxis: [
        { ...b.yAxis, name: `${unit} por año`, scale: false, min: 0 },
        { ...b.yAxis, name: `${unit} en 10 años`, scale: false, min: 0, position: "right", splitLine: { show: false } },
      ],
      grid: { ...b.grid, right: 60 },
      tooltip: { ...b.tooltip, valueFormatter: (v: number) => (v == null ? "—" : `${num(v, 2)} ${unit}`) },
      series: [
        { name: "Año hidrológico", type: "bar", data: yrs.map((y) => (y.total == null ? null : maf(y.total))), itemStyle: { color: t.waterSoft } },
        {
          name: "Suma de los últimos 10 años", type: "line", yAxisIndex: 1, data: yrs.map((y) => (roll.has(y.wy) ? maf(roll.get(y.wy)!) : null)), lineStyle: { color: t.water, width: 2.4 }, itemStyle: { color: t.water },
          markLine: { symbol: "none", lineStyle: { type: "dashed" }, data: [
            { yAxis: maf(x.thresholds.compact), label: { formatter: `75 MAF (Compact)`, color: t.bad }, lineStyle: { color: t.bad } },
            { yAxis: maf(x.thresholds.withMexico), label: { formatter: `82,5 MAF (con la mitad de México)`, color: t.warn }, lineStyle: { color: t.warn } },
          ] },
        },
      ],
    };
  }, [x, u]);
  const last = x?.rolling.at(-1);
  return (
    <section className="card">
      <div className="toolbar"><h2>Compact de 1922 — lo que la Cuenca Alta entrega en Lee Ferry</h2><span className="kind kind-monitor">🟠 CÁLCULO DEL MONITOR</span></div>
      <p className="muted">
        El Compact del Río Colorado (Art. III(d)) dice que la Cuenca Alta (Wyoming, Colorado, Utah, Nuevo México) no debe hacer que el caudal en <b>Lee Ferry</b> baje de <b>75 millones de acre-feet en cualquier período de 10 años</b>.
        Muchos citan 82,5 MAF, sumando la mitad de lo que se le debe a México (1,5 MAF/año por el tratado de 1944); cómo se aplica eso está en discusión entre los estados. No es un umbral de alerta: es una referencia legal.
      </p>
      {d.state === "loading" && <p className="muted">Calculando…</p>}
      {d.state === "error" && <p className="note warn">{d.error}. Se calcula automáticamente cada hora hasta lograrlo.</p>}
      {x && (
        <>
          <div className="kpis snowk two">
            <div className="kpi">
              <span className="kpi-label">Últimos 10 años hidrológicos ({last ? `${last.wy - 9}–${last.wy}` : "—"})</span>
              <span className="kpi-val sm">{last ? `${num(maf(last.af), 2)} ${unit}` : "—"}</span>
              <span className="kpi-sub">{last ? `${num(last.af / 1e6, 1)} MAF · ${last.af >= x.thresholds.withMexico ? "por encima de 82,5 MAF" : last.af >= x.thresholds.compact ? "entre 75 y 82,5 MAF" : "por debajo de 75 MAF"}` : ""}</span>
            </div>
            <div className="kpi">
              <span className="kpi-label">Año hidrológico {x.current?.wy ?? ""} (en curso)</span>
              <span className="kpi-val sm">{x.current ? vol(x.current.af, u) : "—"}</span>
              <span className="kpi-sub">{x.current ? `${x.current.days} días, hasta ${fdate(x.current.to)} · parcial` : ""}</span>
            </div>
          </div>
          <EChart option={opt} style={{ height: 300 }} />
          <p className="note">
            Lee Ferry ≈ Colorado en Lees Ferry (USGS 09380000) + Paria en Lees Ferry (USGS 09382000), suma de caudales medios diarios × 1,9835 por año hidrológico (1-oct a 30-sep).
            Un año con menos del 99 % de los días con dato no se usa y las sumas de 10 años que lo incluyen no se calculan (no se rellenan huecos).
            <b> Es un cálculo del monitor con datos provisorios de USGS</b>; la contabilidad oficial la publican USBR y la Upper Colorado River Commission y puede diferir. Fuente: {x.api}, calculado {fdate(x.builtAt.slice(0, 10))}.
          </p>
        </>
      )}
    </section>
  );
}
