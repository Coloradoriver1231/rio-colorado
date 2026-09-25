import { useMemo, useState } from "react";
import catalog from "../data/catalog.json";
import { CLS_LABEL, type BasinRes, type ResView } from "../lib/calc";
import { elev, fdate, flow, pct, vol, type Units } from "../lib/units";

type SortKey = "cuenca" | "pct" | "storage" | "net" | "vsMedian";

export default function Reservoirs({ views, others, basinState, u, onOpen }: { views: ResView[]; others: BasinRes[]; basinState: "loading" | "ok" | "error"; u: Units; onOpen: (s: number) => void }) {
  const subs = (catalog as any).subbasins as { id: string; name: string }[];
  const [sub, setSub] = useState("todas");
  const [sort, setSort] = useState<SortKey>("cuenca");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    let r = views.filter((v) => (sub === "todas" || v.cat.sub === sub) && (!q || v.cat.name.toLowerCase().includes(q.toLowerCase())));
    const order = subs.map((s) => s.id);
    const val = (v: ResView) =>
      sort === "pct" ? v.pct : sort === "storage" ? v.storage : sort === "net" ? v.net7 : sort === "vsMedian" ? (v.median ? (v.storage || 0) / v.median : null) : null;
    if (sort === "cuenca") r = [...r].sort((a, b) => order.indexOf(a.cat.sub) - order.indexOf(b.cat.sub) || (b.refMax || 0) - (a.refMax || 0));
    else r = [...r].sort((a, b) => (val(b) ?? -Infinity) - (val(a) ?? -Infinity));
    return r;
  }, [views, sub, sort, q, subs]);

  const withData = rows.filter((v) => v.state === "ok" && v.storage != null);
  const without = rows.filter((v) => !(v.state === "ok" && v.storage != null));
  const loading = views.some((v) => v.state === "loading");

  return (
    <section className="card">
      <div className="toolbar">
        <h2>Embalses ({withData.length}{loading ? ", cargando…" : ""})</h2>
        <div className="filters">
          <input placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar embalse" />
          <select value={sub} onChange={(e) => setSub(e.target.value)} aria-label="Subcuenca">
            <option value="todas">Todas las subcuencas</option>
            {subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Ordenar">
            <option value="cuenca">Ordenar: subcuenca</option>
            <option value="pct">Ordenar: % lleno</option>
            <option value="storage">Ordenar: volumen</option>
            <option value="net">Ordenar: balance 7 d</option>
            <option value="vsMedian">Ordenar: vs. mediana</option>
          </select>
        </div>
      </div>
      <div className="tablewrap">
        <table className="restable">
          <thead>
            <tr>
              <th>Embalse</th>
              <th className="num">% lleno</th>
              <th className="num">Volumen</th>
              <th className="num hide-sm">Cota</th>
              <th className="num">Entra 7 d</th>
              <th className="num">Sale 7 d</th>
              <th className="num hide-sm">Balance 30 d</th>
              <th className="hide-sm">Para la fecha</th>
              <th className="hide-sm">Dato</th>
            </tr>
          </thead>
          <tbody>
            {withData.map((v) => {
              const bal30 = v.in30af != null && v.out30af != null ? v.in30af - v.out30af : null;
              return (
                <tr key={v.cat.site} onClick={() => onOpen(v.cat.site)} className={v.stale ? "stale" : ""}>
                  <td>
                    <b>{v.cat.name}</b>
                    <span className="sub">{v.cat.river} · {v.cat.state}</span>
                  </td>
                  <td className="num">
                    <div className="minibar"><i style={{ width: `${Math.min(100, (v.pct || 0) * 100)}%` }} />{v.pctLastYear != null && <b style={{ left: `${Math.min(100, v.pctLastYear * 100)}%` }} />}</div>
                    {pct(v.pct)}{v.pctBasis === "record" ? "*" : ""}
                  </td>
                  <td className="num">{vol(v.storage, u)}</td>
                  <td className="num hide-sm">{elev(v.elevation, u)}</td>
                  <td className="num">{flow(v.inflow7, u)}{v.inflowEstimated ? " *" : ""}</td>
                  <td className="num">{flow(v.release7, u)}</td>
                  <td className={`num hide-sm ${bal30 == null ? "" : bal30 >= 0 ? "pos" : "neg"}`}>{vol(bal30, u, true)}</td>
                  <td className="hide-sm">{v.cls ? <span className={`tag ${v.cls}`}>{CLS_LABEL[v.cls]}</span> : <span className="muted">—</span>}</td>
                  <td className="hide-sm">{fdate(v.lastDate)}{v.stale && <span className="tag bad">viejo</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        % lleno: sobre la capacidad publicada por USBR o, si no la hay, la capacidad útil de NRCS; con * sobre el máximo registrado en la serie. La marca en la barra es el mismo día del año pasado.
        "Para la fecha": comparación con los percentiles 10/50/90 del mismo día en años anteriores. Entra/Sale: caudal medio diario promedio de 7 días. Balance 30 d = volumen que entró − volumen que salió (no incluye evaporación).
        Entrada con * = estimada por balance.
      </p>
      <Others list={others} state={basinState} q={q} u={u} />
      {without.length > 0 && (
        <details className="nodata">
          <summary>{without.length} embalses sin datos {loading ? "(cargando…)" : ""}</summary>
          <ul>
            {without.map((v) => (
              <li key={v.cat.site}>{v.cat.name} ({v.cat.state}) — <span className="muted">{v.state === "loading" ? "cargando…" : v.error || "sin datos de almacenamiento"}</span></li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** Embalses que USBR hydrodata no publica (Granby, Dillon, Ruedi, Salt, Verde, San Carlos…): sólo almacenamiento, vía NRCS. */
function Others({ list, state, q, u }: { list: BasinRes[]; state: "loading" | "ok" | "error"; q: string; u: Units }) {
  const rows = useMemo(
    () => list
      .filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (a.basin === b.basin ? 0 : a.basin === "alta" ? -1 : 1) || a.subbasin.localeCompare(b.subbasin) || (b.capacity_af || 0) - (a.capacity_af || 0)),
    [list, q],
  );
  return (
    <>
      <h3 className="others-title">Resto de la cuenca — sólo almacenamiento (NRCS){state === "loading" ? " · cargando…" : ""}</h3>
      {state === "error" && <p className="note warn">No se pudo cargar NRCS; se reintenta en la próxima actualización.</p>}
      {rows.length > 0 && (
        <div className="tablewrap">
          <table className="restable plain">
            <thead>
              <tr>
                <th>Embalse</th>
                <th className="num">% lleno</th>
                <th className="num">Volumen</th>
                <th className="num hide-sm">Capacidad</th>
                <th className="num">Cambio 30 d</th>
                <th className="num hide-sm">Hace un año</th>
                <th className="hide-sm">Dato</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const p = b.af != null && b.capacity_af ? b.af / b.capacity_af : null;
                const ly = b.last_year_af != null && b.capacity_af ? b.last_year_af / b.capacity_af : null;
                return (
                  <tr key={b.id}>
                    <td><b>{b.name}</b><span className="sub">{b.subbasin} · {b.state}</span></td>
                    <td className="num">
                      <div className="minibar"><i style={{ width: `${Math.min(100, (p || 0) * 100)}%` }} />{ly != null && <b style={{ left: `${Math.min(100, ly * 100)}%` }} />}</div>
                      {pct(p)}
                    </td>
                    <td className="num">{vol(b.af, u)}</td>
                    <td className="num hide-sm">{vol(b.capacity_af, u)}</td>
                    <td className={`num ${b.ch30 == null ? "" : b.ch30 >= 0 ? "pos" : "neg"}`}>{vol(b.ch30, u, true)}</td>
                    <td className="num hide-sm">{pct(ly)}</td>
                    <td className="hide-sm">{fdate(b.date)}{b.freq === "mensual" && <span className="tag">mensual</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
