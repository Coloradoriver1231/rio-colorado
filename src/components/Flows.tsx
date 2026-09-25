import { useMemo, useState } from "react";
import type { ResView } from "../lib/calc";
import { flow, flowUnit, flowVal, num, vol, type Units } from "../lib/units";
import QTag, { QLegend } from "./QTag";
import EChart, { baseOption, theme } from "./EChart";

export default function Flows({ views, u, onOpen }: { views: ResView[]; u: Units; onOpen: (s: number) => void }) {
  const [onlyMajor, setOnlyMajor] = useState(true);
  const rows = useMemo(
    () => views
      .filter((v) => v.state === "ok" && !v.stale && (v.inflow7 != null || v.release7 != null) && (!onlyMajor || v.cat.major))
      .sort((a, b) => (b.refMax || 0) - (a.refMax || 0)),
    [views, onlyMajor],
  );
  const t = theme();
  const opt = useMemo(() => {
    const b = baseOption(t);
    const names = rows.map((v) => v.cat.name + (v.inflowEstimated ? " *" : ""));
    return {
      ...b,
      grid: { left: 120, right: 20, top: 30, bottom: 30 },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: t.bg, borderColor: t.line, textStyle: { color: t.ink }, valueFormatter: (x: number) => `${num(x, u === "metric" ? 1 : 0)} ${flowUnit(u)}` },
      xAxis: { type: "value", name: flowUnit(u), axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.line, type: "dashed" } } },
      yAxis: { type: "category", data: names, inverse: true, axisLabel: { color: t.ink }, axisLine: { lineStyle: { color: t.line } } },
      series: [
        { name: "Entra (7 d)", type: "bar", data: rows.map((v) => (v.inflow7 == null ? null : Math.round(flowVal(v.inflow7, u) * 10) / 10)), itemStyle: { color: t.water } },
        { name: "Sale (7 d)", type: "bar", data: rows.map((v) => (v.release7 == null ? null : Math.round(flowVal(v.release7, u) * 10) / 10)), itemStyle: { color: t.out } },
      ],
    };
  }, [rows, u]);

  return (
    <>
      <section className="card">
        <div className="toolbar">
          <h2>Cuánto entra y cuánto sale</h2>
          <label className="check"><input type="checkbox" checked={onlyMajor} onChange={(e) => setOnlyMajor(e.target.checked)} /> Sólo embalses principales</label>
        </div>
        <EChart option={opt} style={{ height: Math.max(220, rows.length * 44 + 60) }} />
        <p className="note">Caudal medio diario, promedio de los últimos 7 días publicados. * Entrada estimada por balance (Mead, Mohave y Havasu no tienen entrada publicada en la fuente).</p>
      </section>
      <section className="card">
        <h2>Balance de los últimos 30 días</h2>
        <div className="tablewrap">
          <table className="restable">
            <thead>
              <tr><th>Embalse</th><th className="num">Entró</th><th className="num">Salió</th><th className="num">Diferencia</th><th className="num">Cambio real de volumen</th><th className="num hide-sm">Entra/Sale hoy</th></tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const d = v.bal30.v;
                return (
                  <tr key={v.cat.site} onClick={() => onOpen(v.cat.site)}>
                    <td><b>{v.cat.name}</b>{v.inflowEstimated && <span className="sub">entrada estimada</span>}</td>
                    <td className="num">{vol(v.in30af, u)}<QTag s={v.in30} /></td>
                    <td className="num">{vol(v.out30af, u)}<QTag s={v.out30} /></td>
                    <td className={`num ${d == null ? "" : d >= 0 ? "pos" : "neg"}`}>{vol(d, u, true)}<QTag s={v.bal30} /></td>
                    <td className={`num ${v.ch30 == null ? "" : v.ch30 >= 0 ? "pos" : "neg"}`}>{vol(v.ch30, u, true)}</td>
                    <td className="num hide-sm">{flow(v.inflowLast, u)} / {flow(v.releaseLast, u)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <QLegend />
        <p className="note">"Diferencia" (entró − salió, sólo días con ambos datos) y "cambio real de volumen" no coinciden exactamente: la diferencia es evaporación, filtraciones, extracciones directas del lago y el redondeo del dato diario.</p>
      </section>
    </>
  );
}
