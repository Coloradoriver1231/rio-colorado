import catalog from "../data/catalog.json";
import type { GaugesState } from "../lib/useData";
import { ago, flow, flowVal, fdate, type Units } from "../lib/units";

interface G { id: string; name: string; group: string; role?: string }

function Spark({ s }: { s: [number, number][] }) {
  if (s.length < 2) return <svg className="spark" viewBox="0 0 120 32" />;
  const t0 = s[0][0], t1 = s[s.length - 1][0];
  const vs = s.map((p) => p[1]);
  const lo = Math.min(...vs), hi = Math.max(...vs);
  const span = hi - lo || 1;
  const d = s.map((p, i) => `${i ? "L" : "M"}${(((p[0] - t0) / (t1 - t0 || 1)) * 118 + 1).toFixed(1)} ${(30 - ((p[1] - lo) / span) * 28).toFixed(1)}`).join(" ");
  return <svg className="spark" viewBox="0 0 120 32" preserveAspectRatio="none"><path d={d} /></svg>;
}

function nearest(s: [number, number][], t: number, tolH = 2): number | null {
  let best: [number, number] | null = null;
  for (const p of s) if (p[0] <= t && (!best || p[0] > best[0])) best = p;
  return best && t - best[0] <= tolH * 3600000 ? best[1] : null;
}

export default function Rivers({ gauges, u }: { gauges: GaugesState; u: Units }) {
  const groups = (catalog as any).gauge_groups as { id: string; name: string }[];
  const list = (catalog as any).gauges as G[];
  return (
    <section className="card">
      <h2>Caudal de los ríos — de aguas arriba a aguas abajo</h2>
      {gauges.state === "error" && <p className="note warn">USGS no responde en este momento ({gauges.error}). Se reintenta solo cada 15 minutos{gauges.lastRunAt ? ` (último intento ${ago(Date.parse(gauges.lastRunAt))})` : ""}.</p>}
      {gauges.stale && gauges.fetchedAt && <p className="note warn">USGS no responde: se muestra el último dato bueno, guardado {ago(Date.parse(gauges.fetchedAt))}.</p>}
      {groups.map((g) => (
        <div key={g.id} className="rgroup">
          <h3>{g.name}</h3>
          <div className="rlist">
            {list.filter((x) => x.group === g.id).map((x) => {
              const s = gauges.gauges[x.id]?.series || [];
              const last = s.length ? s[s.length - 1] : null;
              const d24 = last ? nearest(s, last[0] - 86400000) : null;
              const mean7 = s.length ? s.reduce((a, p) => a + p[1], 0) / s.length : null;
              const ageH = last ? (Date.now() - last[0]) / 3600000 : null;
              const stale = ageH != null && ageH > 24;
              return (
                <div key={x.id} className={`rrow ${stale ? "stale" : ""}`}>
                  <div className="rname">
                    <b>{x.name}</b>
                    <span className="sub">{x.role ? `${x.role} · ` : ""}USGS {x.id}</span>
                  </div>
                  <Spark s={s} />
                  <div className="rval">
                    <b>{gauges.state === "loading" ? "…" : flow(last?.[1], u)}</b>
                    <span className="sub">
                      {last ? (
                        <>
                          24 h: {d24 != null ? flow(last[1] - d24, u, true) : "—"} · prom. 7 d (lecturas horarias, {s.length}/168 h) {flow(mean7, u)}
                          {stale && <> · <span className="tag bad">dato del {fdate(new Date(last[0]).toISOString().slice(0, 10))}</span></>}
                        </>
                      ) : gauges.state === "loading" ? "" : "sin datos recientes"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <p className="note">{gauges.state === "ok" && gauges.fetchedAt && <>Datos de USGS actualizados {ago(Date.parse(gauges.fetchedAt))}{gauges.lastRunAt ? `, última consulta ${ago(Date.parse(gauges.lastRunAt))}` : ""}{gauges.errors?.length ? ` (avisos: ${gauges.errors.join("; ")})` : ""}. </>}USGS, valores instantáneos provisorios (se muestra el último de cada hora, últimos 7 días). Unidades: {u === "metric" ? `m³/s (1 cfs = ${flowVal(1, "metric").toFixed(4)} m³/s)` : "pies cúbicos por segundo"}.</p>
    </section>
  );
}
