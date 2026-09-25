import { useEffect, useMemo, useState } from "react";
import type { SnowStatus, Val } from "../../netlify/lib/snow";
import { fdate, num, pct, type Units } from "../lib/units";
import EChart, { baseOption, theme } from "./EChart";

const depth = (inch: number | null | undefined, u: Units) =>
  inch == null || !Number.isFinite(inch) ? "—" : u === "metric" ? `${num(inch * 25.4, inch * 25.4 < 10 ? 1 : 0)} mm` : `${num(inch, 1)} in`;
const snowDepth = (inch: number | null | undefined, u: Units) =>
  inch == null || !Number.isFinite(inch) ? "—" : u === "metric" ? `${num(inch * 2.54, 0)} cm` : `${num(inch, 0)} in`;
const elevTxt = (ft: number | null, u: Units) => (ft == null ? "—" : u === "metric" ? `${num(ft * 0.3048, 0)} m` : `${num(ft, 0)} ft`);
const STATE: Record<string, string> = { ok: "con dato", stale: "desactualizada", noObs: "sin observación", error: "error de consulta" };

/** Lista de todas las estaciones SNOTEL esperadas, con su estado y sus valores de hoy. */
export default function Stations({ s, u, onOpen }: { s: SnowStatus; u: Units; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [basin, setBasin] = useState<"alta" | "baja" | "todas">("alta");
  const [sort, setSort] = useState<"sub" | "swe" | "elev" | "name">("sub");
  const byId = useMemo(() => new Map(s.stations.map((x) => [x.id, x])), [s]);
  const rows = useMemo(() => {
    const list = (s.roster ?? s.stations.map((x) => ({ id: x.id, name: x.name, elev: x.elev, lat: x.lat, lon: x.lon, subbasin: x.subbasin, basin: x.basin, state: "ok" as const, last: x.date })))
      .filter((r) => (basin === "todas" || r.basin === basin) && (!q || `${r.name} ${r.subbasin} ${r.id}`.toLowerCase().includes(q.toLowerCase())));
    const v = (r: { id: string }) => byId.get(r.id)?.swe ?? -1;
    return [...list].sort((a, b) =>
      sort === "swe" ? v(b) - v(a) : sort === "elev" ? (b.elev ?? 0) - (a.elev ?? 0) : sort === "name" ? a.name.localeCompare(b.name) : a.subbasin.localeCompare(b.subbasin) || (b.elev ?? 0) - (a.elev ?? 0),
    );
  }, [s, q, basin, sort, byId]);

  return (
    <>
      <div className="toolbar">
        <div className="filters">
          <input placeholder="Buscar estación…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar estación" />
          <select value={basin} onChange={(e) => setBasin(e.target.value as any)} aria-label="Cuenca">
            <option value="alta">Cuenca Alta</option><option value="baja">Cuenca Baja</option><option value="todas">Todas</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Ordenar">
            <option value="sub">Ordenar: subcuenca</option><option value="swe">Ordenar: más nieve</option><option value="elev">Ordenar: más alta</option><option value="name">Ordenar: nombre</option>
          </select>
        </div>
        <span className="muted">{rows.length} estaciones · tocá una para ver su temporada</span>
      </div>
      <div className="tablewrap stlist">
        <table className="restable">
          <thead><tr><th>Estación</th><th className="num">Altura</th><th className="num">SWE hoy</th><th className="num">Mediana</th><th className="num hide-sm">Altura nieve</th><th className="num hide-sm">Precip. año</th><th className="hide-sm">Estado</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const x = byId.get(r.id);
              const p = x?.swe != null && x.sweMed != null && x.sweMed >= 1 ? x.swe / x.sweMed : null;
              return (
                <tr key={r.id} onClick={() => onOpen(r.id)} className={r.state !== "ok" ? "stale" : ""}>
                  <td><b>{r.name}</b><span className="sub">{r.subbasin} · {r.id}</span></td>
                  <td className="num">{elevTxt(r.elev, u)}</td>
                  <td className="num">{x ? depth(x.swe, u) : "—"}{p != null && <span className="sub">{pct(p)} de la mediana</span>}</td>
                  <td className="num">{x ? depth(x.sweMed, u) : "—"}</td>
                  <td className="num hide-sm">{x ? snowDepth(x.snwd, u) : "—"}</td>
                  <td className="num hide-sm">{x ? depth(x.prec, u) : "—"}</td>
                  <td className="hide-sm">{r.state === "ok" ? <span className="muted">{fdate(r.last)}</span> : <span className="tag bad">{STATE[r.state]}{r.last ? ` (${fdate(r.last)})` : ""}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

type Detail = { id: string; wy: number; begin: string; end: string; meta: { name: string; elev: number | null; subbasin: string; lat: number; lon: number } | null; swe: Val[]; depth: Val[]; prec: Val[]; tavg?: Val[]; tmax?: Val[]; tmin?: Val[]; links: { nrcs: string; report: string } };

/** Ficha de una estación: toda la temporada, con su mediana. */
export function StationModal({ id, u, onClose, curWy, name }: { id: string; u: Units; onClose: () => void; curWy: number; name?: string }) {
  const [wy, setWy] = useState(curWy);
  const [d, setD] = useState<{ state: "loading" | "ok" | "error"; data?: Detail; error?: string }>({ state: "loading" });
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);
  useEffect(() => {
    let alive = true;
    setD({ state: "loading" });
    fetch(`/api/snotel/${encodeURIComponent(id)}?wy=${wy}`)
      .then(async (r) => {
        const b = await r.json().catch(() => null);
        if (alive) setD(r.ok && b ? { state: "ok", data: b } : { state: "error", error: b?.error || `HTTP ${r.status}` });
      })
      .catch((e) => alive && setD({ state: "error", error: String(e?.message || e) }));
    return () => { alive = false; };
  }, [id, wy]);

  const t = theme();
  const opt = useMemo(() => {
    const x = d.data;
    if (!x) return null;
    const b = baseOption(t);
    const cv = (v: number) => Math.round((u === "metric" ? v * 25.4 : v) * 10) / 10;
    const cm = (v: number) => Math.round(u === "metric" ? v * 2.54 : v);
    return {
      ...b,
      tooltip: { ...b.tooltip },
      yAxis: [
        { ...b.yAxis, name: u === "metric" ? "mm de agua" : "pulgadas de agua", scale: false, min: 0 },
        { ...b.yAxis, name: u === "metric" ? "cm de nieve" : "pulgadas de nieve", scale: false, min: 0, splitLine: { show: false }, position: "right" },
      ],
      grid: { ...b.grid, right: 56 },
      series: [
        { name: "SWE", type: "line", data: x.swe.map((v) => [v.date, cv(v.value)]), symbol: "none", lineStyle: { color: t.water, width: 2.4 }, itemStyle: { color: t.water }, areaStyle: { color: t.waterSoft, opacity: 0.35 } },
        { name: "SWE mediana 1991–2020", type: "line", data: x.swe.filter((v) => v.median != null).map((v) => [v.date, cv(v.median!)]), symbol: "none", lineStyle: { color: t.water, type: "dashed", width: 1.2 }, itemStyle: { color: t.water } },
        { name: "Precipitación acumulada", type: "line", data: x.prec.map((v) => [v.date, cv(v.value)]), symbol: "none", lineStyle: { color: t.out, width: 1.6 }, itemStyle: { color: t.out } },
        { name: "Altura de nieve", type: "line", yAxisIndex: 1, data: x.depth.map((v) => [v.date, cm(v.value)]), symbol: "none", lineStyle: { color: t.muted, width: 1 }, itemStyle: { color: t.muted } },
      ],
    };
  }, [d, u]);

  const tOpt = useMemo(() => {
    const x = d.data;
    if (!x?.tmax?.length && !x?.tavg?.length) return null;
    const b = baseOption(t);
    const c = (f: number) => Math.round((u === "metric" ? ((f - 32) * 5) / 9 : f) * 10) / 10;
    const unit = u === "metric" ? "°C" : "°F";
    return {
      ...b,
      yAxis: { ...b.yAxis, name: unit },
      tooltip: { ...b.tooltip, valueFormatter: (v: number) => (v == null ? "—" : `${v} ${unit}`) },
      series: [
        { name: "Máxima", type: "line", data: (x.tmax || []).map((v) => [v.date, c(v.value)]), symbol: "none", lineStyle: { color: t.out, width: 1 }, itemStyle: { color: t.out } },
        { name: "Media", type: "line", data: (x.tavg || []).map((v) => [v.date, c(v.value)]), symbol: "none", lineStyle: { color: t.ink, width: 1.4 }, itemStyle: { color: t.ink } },
        { name: "Media histórica (1991–2020)", type: "line", data: (x.tavg || []).filter((v) => v.average != null).map((v) => [v.date, c(v.average!)]), symbol: "none", lineStyle: { color: t.muted, type: "dashed", width: 1 }, itemStyle: { color: t.muted } },
        { name: "Mínima", type: "line", data: (x.tmin || []).map((v) => [v.date, c(v.value)]), symbol: "none", lineStyle: { color: t.water, width: 1 }, itemStyle: { color: t.water },
          markLine: { symbol: "none", label: { formatter: "0 °C", color: t.muted }, lineStyle: { color: t.muted }, data: [{ yAxis: u === "metric" ? 0 : 32 }] } },
      ],
    };
  }, [d, u]);

  const x = d.data;
  const last = <T extends Val>(a?: T[]) => (a && a.length ? a[a.length - 1] : null);
  const lw = last(x?.swe), ld = last(x?.depth), lp = last(x?.prec);
  const peak = x?.swe.length ? x.swe.reduce((a, v) => (v.value > a.value ? v : a)) : null;
  const unitW = (v: number | null | undefined) => depth(v, u);

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Estación SNOTEL">
        <header className="drawer-head">
          <div>
            <h2>{x?.meta?.name || name || id}</h2>
            <span className="muted">SNOTEL {id}{x?.meta ? ` · ${x.meta.subbasin} · ${elevTxt(x.meta.elev, u)}` : ""}</span>
          </div>
          <button className="refresh" onClick={onClose} aria-label="Cerrar">Cerrar ✕</button>
        </header>
        <div className="seg" role="group" aria-label="Temporada">
          <button className={wy === curWy ? "on" : ""} onClick={() => setWy(curWy)}>Temporada {curWy}</button>
          <button className={wy === curWy - 1 ? "on" : ""} onClick={() => setWy(curWy - 1)}>Temporada {curWy - 1}</button>
        </div>
        {d.state === "loading" && <p className="muted">Cargando…</p>}
        {d.state === "error" && <p className="note warn">{d.error}</p>}
        {x && (
          <>
            <div className="stats">
              <div><span>SWE al {fdate(lw?.date)}</span><b>{unitW(lw?.value)}</b></div>
              <div><span>Mediana para esa fecha</span><b>{unitW(lw?.median)}{lw?.median != null && lw.median >= 1 ? ` (${pct(lw.value / lw.median)})` : ""}</b></div>
              <div><span>Altura de nieve</span><b>{snowDepth(ld?.value, u)}</b></div>
              <div><span>Precipitación desde el 1-oct</span><b>{unitW(lp?.value)}{lp?.median ? ` (${pct(lp.value / lp.median)} de la mediana)` : ""}</b></div>
              <div><span>Pico de SWE de la temporada</span><b>{peak ? `${unitW(peak.value)} (${fdate(peak.date)})` : "—"}</b></div>
            </div>
            <EChart option={opt} style={{ height: 300 }} />
            <p className="note">
              SWE = agua guardada como nieve (lo que mide el colchón de nieve). Altura de nieve = centímetros de nieve en el suelo (eje derecho). Precipitación = todo lo que cayó desde el 1-oct, en agua. No se suman.
              Datos provisorios de NRCS; la mediana es la oficial 1991–2020 de la estación.
            </p>
            {tOpt && <><h3>Temperatura del aire</h3><EChart option={tOpt} style={{ height: 220 }} /><p className="note">Con máximas sobre 0 °C la nieve puede empezar a derretirse; el deshielo depende también de la radiación solar, el viento y la humedad.</p></>}
            <p className="note"><a href={x.links.nrcs} target="_blank" rel="noreferrer">Ficha oficial de la estación (NRCS)</a> · <a href={x.links.report} target="_blank" rel="noreferrer">Tabla diaria de los últimos 30 días (NRCS)</a></p>
          </>
        )}
      </aside>
    </div>
  );
}
