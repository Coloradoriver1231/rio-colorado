import { useEffect, useMemo } from "react";
import { CLS_LABEL, smooth7, type ResView } from "../lib/calc";
import QTag from "./QTag";
import { addDays, doyIndex, type Pt } from "../shared/process";
import { elev, elevUnit, elevVal, fdate, flow, flowUnit, flowVal, num, pct, vol, volUnit, volVal, type Units } from "../lib/units";
import EChart, { baseOption, theme } from "./EChart";

function bandFor(v: ResView, conv: (x: number) => number) {
  const st = v.data?.series.storage;
  if (!st?.doy || !st.recent.length) return null;
  const start = st.recent[0][0];
  const end = st.last[0];
  const p10: [string, number][] = [], width: [string, number][] = [], p50: [string, number][] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const i = doyIndex(d);
    const a = st.doy.p10[i], m = st.doy.p50[i], b = st.doy.p90[i];
    if (a == null || m == null || b == null) continue;
    p10.push([d, conv(a)]); width.push([d, conv(b) - conv(a)]); p50.push([d, conv(m)]);
  }
  return { p10, width, p50, years: st.doy.years };
}

export default function Detail({ v, u, onClose }: { v: ResView; u: Units; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);

  const t = theme();
  const s = v.data?.series;
  const cv = (x: number) => volVal(x, u);
  const cf = (x: number) => flowVal(x, u);
  const ce = (x: number) => elevVal(x, u);
  const map = (pts: Pt[] | undefined, f: (x: number) => number) => (pts || []).map((p) => [p[0], Math.round(f(p[1]) * 100) / 100]);

  const storageOpt = useMemo(() => {
    const band = bandFor(v, cv);
    const b = baseOption(t);
    return {
      ...b,
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => `${num(x, u === "metric" ? 0 : 0)} ${volUnit(u)}` },
      yAxis: { ...b.yAxis, name: volUnit(u) },
      series: [
        ...(band ? [
          { name: "p10", type: "line", stack: "band", data: band.p10, lineStyle: { opacity: 0 }, symbol: "none", tooltip: { show: false }, silent: true },
          { name: `Rango normal (p10–p90, ${band.years} años)`, type: "line", stack: "band", data: band.width, lineStyle: { opacity: 0 }, symbol: "none", itemStyle: { color: t.band }, areaStyle: { color: t.band }, tooltip: { show: false }, silent: true },
          { name: "Mediana histórica", type: "line", data: band.p50, symbol: "none", lineStyle: { color: t.muted, type: "dashed", width: 1 }, itemStyle: { color: t.muted } },
        ] : []),
        { name: "Almacenamiento", type: "line", data: map(s?.storage?.recent, cv), symbol: "none", lineStyle: { color: t.water, width: 2.5 }, itemStyle: { color: t.water },
          markLine: v.pctBasis === "capacity" && v.refMax ? { symbol: "none", label: { formatter: "Capacidad", color: t.muted }, lineStyle: { color: t.muted }, data: [{ yAxis: Math.round(cv(v.refMax)) }] } : undefined },
      ],
      legend: { ...b.legend, data: ["Almacenamiento", "Mediana histórica", ...(band ? [`Rango normal (p10–p90, ${band.years} años)`] : [])] },
    };
  }, [v, u]);

  const flowOpt = useMemo(() => {
    const b = baseOption(t);
    return {
      ...b,
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => `${num(x, u === "metric" ? 1 : 0)} ${flowUnit(u)}` },
      yAxis: { ...b.yAxis, name: flowUnit(u), scale: false },
      dataZoom: [{ type: "inside", start: 70, end: 100 }],
      series: [
        { name: v.inflowEstimated ? "Entrada (estimada, media móvil 7 d)" : "Entrada", type: "line", data: map(v.inflowEstimated ? smooth7(v.inflowSeries) : v.inflowSeries, cf), symbol: "none", lineStyle: { color: t.water, width: 1.8 }, itemStyle: { color: t.water }, areaStyle: { color: t.waterSoft, opacity: 0.5 } },
        { name: "Salida", type: "line", data: map(v.releaseSeries, cf), symbol: "none", lineStyle: { color: t.out, width: 1.8 }, itemStyle: { color: t.out } },
      ],
    };
  }, [v, u]);

  const elevOpt = useMemo(() => {
    const b = baseOption(t);
    const lv = v.cat.levels_ft || [];
    return {
      ...b,
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => `${num(x, 2)} ${u === "metric" ? "m" : "ft"}` },
      yAxis: { ...b.yAxis, name: elevUnit(u) },
      series: [{ name: "Cota", type: "line", data: map(s?.elevation?.recent, ce), symbol: "none", lineStyle: { color: t.water, width: 2 },
        markLine: lv.length ? { symbol: "none", label: { formatter: (p: any) => p.name, color: t.muted, position: "insideEndTop" }, lineStyle: { color: t.bad, type: "dotted" },
          data: lv.map((l) => ({ name: l.label, yAxis: Math.round(ce(l.ft) * 100) / 100 })) } : undefined }],
    };
  }, [v, u]);

  const histOpt = useMemo(() => {
    const b = baseOption(t);
    const m = s?.storage?.monthly;
    if (!m || m.length < 24) return null;
    return {
      ...b,
      tooltip: { ...b.tooltip, valueFormatter: (x: number) => `${num(x)} ${volUnit(u)}` },
      yAxis: { ...b.yAxis, name: volUnit(u), scale: false },
      dataZoom: [{ type: "inside" }],
      series: [{ name: "Almacenamiento (fin de mes)", type: "line", data: map(m, cv), symbol: "none", lineStyle: { color: t.water, width: 1.5 }, areaStyle: { color: t.waterSoft, opacity: 0.6 } }],
    };
  }, [v, u]);

  const st = s?.storage;
  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Detalle ${v.cat.name}`}>
        <header className="drawer-head">
          <div>
            <h2>{v.cat.name}</h2>
            <span className="muted">{v.cat.dam ? `Presa ${v.cat.dam} · ` : ""}Río {v.cat.river} · {v.cat.state} · USBR sitio {v.cat.site}</span>
          </div>
          <button className="x" onClick={onClose} aria-label="Cerrar">×</button>
        </header>
        {v.state !== "ok" ? (
          <p className="note warn">{v.state === "loading" ? "Cargando…" : v.error || "Sin datos."}</p>
        ) : (
          <>
            {v.stale && <p className="note warn">El último dato publicado es del {fdate(v.lastDate)} ({v.ageDays} días). No se toma como estado actual.</p>}
            <div className="stats">
              <div><span>% lleno{v.pctBasis === "record" ? " (del máx. registrado)" : ""}</span><b>{pct(v.pct, 1)}</b></div>
              <div><span>Volumen</span><b>{vol(v.storage, u)}</b></div>
              <div><span>Cota</span><b>{elev(v.elevation, u)}</b></div>
              <div><span>Hace un año</span><b>{pct(v.pctLastYear, 1)}</b></div>
              <div><span>Cambio 1 / 7 / 30 días</span><b>{vol(v.ch1, u, true)} / {vol(v.ch7, u, true)} / {vol(v.ch30, u, true)}</b></div>
              <div><span>vs. mediana ({v.statYears ?? "—"} años)</span><b>{vol(v.vsMedian, u, true)} {v.cls && <span className={`tag ${v.cls}`}>{CLS_LABEL[v.cls]}</span>}</b></div>
              <div><span>Entra: último día / prom. 7 d</span><b>{flow(v.inflowLast, u)} / {flow(v.inflow7, u)}<QTag q={v.inflowQ} /></b></div>
              <div><span>Sale: último día / prom. 7 d</span><b>{flow(v.releaseLast, u)} / {flow(v.release7, u)}<QTag q={v.releaseQ} /></b></div>
              <div><span>Volumen entrado / salido 30 d</span><b>{vol(v.in30af, u)}<QTag s={v.in30} /> / {vol(v.out30af, u)}<QTag s={v.out30} /></b></div>
              {v.pctBasis === "capacity" && <div><span>Capacidad {v.capSource === "nrcs" ? "útil (NRCS)" : "(USBR)"}</span><b>{vol(v.refMax, u)}</b></div>}
              {st && <div><span>Máximo registrado</span><b>{vol(st.max[1], u)} ({fdate(st.max[0])})</b></div>}
              {st && <div><span>Mínimo registrado</span><b>{vol(st.min[1], u)} ({fdate(st.min[0])})</b></div>}
            </div>
            <h3>Almacenamiento — últimos 2 años vs. lo normal para cada fecha</h3>
            <EChart option={storageOpt} />
            {(v.inflowSeries.length > 0 || v.releaseSeries.length > 0) && (
              <>
                <h3>Cuánto entra y cuánto sale (caudal medio diario)</h3>
                <EChart option={flowOpt} />
                {v.inflowEstimated && <p className="note">Entrada estimada = salida + cambio diario de almacenamiento, media móvil 7 días. No descuenta evaporación, así que subestima un poco la entrada real.</p>}
              </>
            )}
            {s?.elevation && (<><h3>Cota del embalse</h3><EChart option={elevOpt} /></>)}
            {histOpt && (<><h3>Historia completa (desde {fdate(st?.first)})</h3><EChart option={histOpt} style={{ height: 240 }} /></>)}
            <p className="note">
              Fuente: USBR hydrodata, datos diarios provisorios. Último dato: {fdate(v.lastDate)}.{" "}
              {Object.entries(v.data?.errors || {}).map(([k, e]) => `${k}: ${e}`).join(" · ")}
            </p>
          </>
        )}
      </aside>
    </div>
  );
}
