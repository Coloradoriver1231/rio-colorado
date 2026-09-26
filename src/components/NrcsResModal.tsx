import { useEffect, useMemo, useState } from "react";
import type { SeriesSummary } from "../shared/process";
import { doyIndex } from "../shared/process";
import { fdate, num, pct, vol, volUnit, volVal, type Units } from "../lib/units";
import EChart, { baseOption, theme } from "./EChart";

type Data = {
  id: string; name: string | null; state: string | null; capacity_af: number | null; freq: "diario" | "mensual";
  summary: SeriesSummary; monthlyStats: { years: number; p10: number[]; p50: number[]; p90: number[] } | null; links: { nrcs: string };
};

/** Ficha de un embalse que sólo publica NRCS (almacenamiento): San Carlos, Salt, Verde, Granby, Dillon, etc. */
export default function NrcsResModal({ id, name, u, onClose }: { id: string; name?: string; u: Units; onClose: () => void }) {
  const [d, setD] = useState<{ state: "loading" | "ok" | "error"; data?: Data; error?: string }>({ state: "loading" });
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);
  useEffect(() => {
    let alive = true;
    fetch(`/api/nrcsres/${encodeURIComponent(id)}`)
      .then(async (r) => { const b = await r.json().catch(() => null); if (alive) setD(r.ok && b ? { state: "ok", data: b } : { state: "error", error: b?.error || `HTTP ${r.status}` }); })
      .catch((e) => alive && setD({ state: "error", error: String(e?.message || e) }));
    return () => { alive = false; };
  }, [id]);

  const t = theme();
  const x = d.data;
  const band = useMemo(() => {
    if (!x) return null;
    const pts = x.summary.recent;
    const get = (date: string) => {
      if (x.freq === "diario" && x.summary.doy) { const i = doyIndex(date); return [x.summary.doy.p10[i], x.summary.doy.p50[i], x.summary.doy.p90[i]] as const; }
      if (x.freq === "mensual" && x.monthlyStats) { const m = Number(date.slice(5, 7)) - 1; return [x.monthlyStats.p10[m], x.monthlyStats.p50[m], x.monthlyStats.p90[m]] as const; }
      return null;
    };
    const rows = pts.map(([date]) => ({ date, b: get(date) })).filter((r) => r.b && r.b.every((v) => v != null));
    return { rows, years: x.freq === "diario" ? x.summary.doy?.years : x.monthlyStats?.years };
  }, [x]);

  const opt = useMemo(() => {
    if (!x) return null;
    const b = baseOption(t);
    const cv = (v: number) => Math.round(volVal(v, u));
    return {
      ...b,
      tooltip: { ...b.tooltip, valueFormatter: (v: number) => `${num(v)} ${volUnit(u)}` },
      yAxis: { ...b.yAxis, name: volUnit(u) },
      legend: { ...b.legend, data: ["Almacenamiento", ...(band?.rows.length ? ["Mediana histórica", `Rango normal (p10–p90, ${band.years} años)`] : [])] },
      series: [
        ...(band?.rows.length ? [
          { name: "p10", type: "line", stack: "band", data: band.rows.map((r) => [r.date, cv(r.b![0]!)]), lineStyle: { opacity: 0 }, symbol: "none", tooltip: { show: false }, silent: true },
          { name: `Rango normal (p10–p90, ${band.years} años)`, type: "line", stack: "band", data: band.rows.map((r) => [r.date, cv(r.b![2]! - r.b![0]!)]), lineStyle: { opacity: 0 }, symbol: "none", areaStyle: { color: t.band }, itemStyle: { color: t.band }, tooltip: { show: false }, silent: true },
          { name: "Mediana histórica", type: "line", data: band.rows.map((r) => [r.date, cv(r.b![1]!)]), symbol: "none", lineStyle: { color: t.muted, type: "dashed", width: 1 }, itemStyle: { color: t.muted } },
        ] : []),
        { name: "Almacenamiento", type: "line", data: x.summary.recent.map(([dt, v]) => [dt, cv(v)]), symbol: x.freq === "mensual" ? "circle" : "none", lineStyle: { color: t.water, width: 2.4 }, itemStyle: { color: t.water },
          markLine: x.capacity_af ? { symbol: "none", label: { formatter: "Capacidad", color: t.muted }, lineStyle: { color: t.muted }, data: [{ yAxis: cv(x.capacity_af) }] } : undefined },
      ],
    };
  }, [x, u, band]);

  const last = x?.summary.last;
  const p = last && x?.capacity_af ? last[1] / x.capacity_af : null;
  const ageDays = last ? Math.round((Date.now() - Date.parse(last[0] + "T00:00:00Z")) / 86400e3) : null;
  const med = x && last ? (x.freq === "diario" ? x.summary.doy?.p50[doyIndex(last[0])] : x.monthlyStats?.p50[Number(last[0].slice(5, 7)) - 1]) : null;

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Embalse (NRCS)">
        <header className="drawer-head">
          <div>
            <h2>{x?.name || name || id}</h2>
            <span className="muted">{x?.state ?? ""} · NRCS {id} · sólo almacenamiento</span>
          </div>
          <button className="refresh" onClick={onClose} aria-label="Cerrar">Cerrar ✕</button>
        </header>
        {d.state === "loading" && <p className="muted">Cargando…</p>}
        {d.state === "error" && <p className="note warn">{d.error}</p>}
        {x && last && (
          <>
            {ageDays != null && ageDays > (x.freq === "mensual" ? 45 : 4) && <p className="note warn">El último dato publicado es del {fdate(last[0])}.</p>}
            <div className="stats">
              <div><span>% lleno</span><b>{pct(p, 1)}</b></div>
              <div><span>Volumen</span><b>{vol(last[1], u)}</b></div>
              <div><span>Capacidad útil (NRCS)</span><b>{vol(x.capacity_af, u)}</b></div>
              <div><span>Dato</span><b>{fdate(last[0])} · {x.freq}</b></div>
              <div><span>vs. mediana ({x.freq === "diario" ? "mismo día" : "mismo mes"})</span><b>{med != null ? vol(last[1] - med, u, true) : "—"}</b></div>
              <div><span>Máximo desde 1991</span><b>{vol(x.summary.max[1], u)} ({fdate(x.summary.max[0])})</b></div>
            </div>
            <h3>Almacenamiento — últimos 2 años vs. lo normal</h3>
            <EChart option={opt} style={{ height: 300 }} />
            <p className="note">
              NRCS publica sólo el almacenamiento de este embalse: no hay datos públicos de entrada ni salida en esta fuente.
              {x.freq === "mensual" ? " El dato es mensual (fin de mes); por eso no suma al total diario de la cuenca." : ""} Percentiles con los años anteriores desde 1991. Datos provisorios.
            </p>
            <p className="note"><a href={x.links.nrcs} target="_blank" rel="noreferrer">Datos en NRCS</a></p>
          </>
        )}
      </aside>
    </div>
  );
}
