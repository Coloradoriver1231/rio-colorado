import { useEffect, useMemo, useState } from "react";
import { fdate, pct, vol, type Units } from "../lib/units";

type P = { id: string; name: string; river: string; subbasin: string; basin: "alta" | "baja"; reservoir: boolean; publicationDate: string | null; period: [string, string] | null; unit: string | null; normal: number | null; values: Record<string, number>; history: number };

const toAf = (v: number | null | undefined, unit: string | null) => (v == null ? null : unit === "kac_ft" ? v * 1000 : unit === "ac_ft" ? v : null);
const per = (p: [string, string] | null) => (p ? `${p[0].split("-").reverse().join("/")}–${p[1].split("-").reverse().join("/")}` : "—");

/** Pronósticos oficiales NRCS/CBRFC de volumen para los demás embalses y ríos de la cuenca. */
export default function OtherForecasts({ u }: { u: Units }) {
  const [d, setD] = useState<{ state: "loading" | "ok" | "error"; points?: P[]; at?: string; wy?: number; error?: string }>({ state: "loading" });
  const [all, setAll] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/forecasts?b=${Math.floor(Date.now() / 3600e3)}`)
      .then(async (r) => { const b = await r.json().catch(() => null); if (alive) setD(r.ok && b?.points ? { state: "ok", points: b.points, at: b.fetchedAt, wy: b.wy } : { state: "error", error: b?.error || `HTTP ${r.status}` }); })
      .catch((e) => alive && setD({ state: "error", error: String(e?.message || e) }));
    return () => { alive = false; };
  }, []);
  const rows = useMemo(() => (d.points || [])
    .filter((p) => p.id !== "09379900:AZ:USGS" && (all || p.reservoir))
    .sort((a, b) => (a.basin === b.basin ? 0 : a.basin === "alta" ? -1 : 1) || a.subbasin.localeCompare(b.subbasin) || a.name.localeCompare(b.name)), [d, all]);
  const withFc = rows.filter((p) => p.publicationDate);

  if (d.state === "loading") return <p className="muted">Cargando pronósticos oficiales…</p>;
  if (d.state === "error") return <p className="note warn">No se pudieron cargar: {d.error}</p>;
  return (
    <>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="Puntos">
          <button className={!all ? "on" : ""} onClick={() => setAll(false)}>Entradas a embalses</button>
          <button className={all ? "on" : ""} onClick={() => setAll(true)}>Todos los puntos (ríos incluidos)</button>
        </div>
        <span className="muted">{withFc.length} con pronóstico en el año hidrológico {d.wy} · {rows.length - withFc.length} todavía sin publicar</span>
      </div>
      {withFc.length === 0 ? (
        <p className="note">Todavía no hay pronósticos publicados para el año hidrológico {d.wy}: NRCS y CBRFC los emiten de enero a junio.</p>
      ) : (
        <div className="tablewrap">
          <table className="restable plain">
            <thead><tr><th>Punto de pronóstico</th><th>Período</th><th className="num">Seco (90 %)</th><th className="num">Central (50 %)</th><th className="num">Húmedo (10 %)</th><th className="num">Central vs normal</th><th className="hide-sm">Publicado</th></tr></thead>
            <tbody>
              {withFc.map((p) => {
                const c = toAf(p.values["50"], p.unit), n = toAf(p.normal, p.unit);
                return (
                  <tr key={p.id}>
                    <td><b>{p.name}</b><span className="sub">{p.subbasin} · {p.river}</span></td>
                    <td>{per(p.period)}</td>
                    <td className="num">{vol(toAf(p.values["90"], p.unit), u)}</td>
                    <td className="num"><b>{vol(c, u)}</b></td>
                    <td className="num">{vol(toAf(p.values["10"], p.unit), u)}</td>
                    <td className="num">{c != null && n ? pct(c / n) : "—"}</td>
                    <td className="hide-sm">{fdate(p.publicationDate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        Pronóstico oficial coordinado NRCS–CBRFC de volumen <b>no regulado</b> para cada punto, última publicación del año hidrológico. El período puede ser distinto según el punto y la fecha (después de abril se pronostica sólo lo que falta de la temporada):
        compará sólo filas con el mismo período. "Normal" = la que publica NRCS con el pronóstico. Fuente: NRCS AWDB /forecasts, consultado {fdate(d.at?.slice(0, 10))}.
      </p>
    </>
  );
}
