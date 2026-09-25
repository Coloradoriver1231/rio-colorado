import type { ResView, SystemTotals } from "../lib/calc";
import { CLS_LABEL } from "../lib/calc";
import type { GaugesState } from "../lib/useData";
import { elev, elevVal, fdate, flow, pct, signed, vol, type Units } from "../lib/units";
import Schematic from "./Schematic";

function LevelBar({ v, u }: { v: ResView; u: Units }) {
  const lv = v.cat.levels_ft;
  if (!lv || v.elevation == null) return null;
  const hi = Math.max(...lv.map((l) => l.ft));
  const lo = Math.min(...lv.map((l) => l.ft)) - 40;
  const y = (ft: number) => ((hi - ft) / (hi - lo)) * 100;
  const cur = Math.max(lo, Math.min(hi, v.elevation));
  return (
    <div className="levelbar" aria-label="Cota actual frente a niveles de referencia">
      <div className="lb-col">
        <div className="lb-water" style={{ top: `${y(cur)}%` }} />
        {lv.map((l) => (
          <div key={l.ft} className="lb-mark" style={{ top: `${y(l.ft)}%` }} />
        ))}
        <div className="lb-now" style={{ top: `${y(cur)}%` }} />
      </div>
      <div className="lb-labels">
        {lv.map((l) => (
          <div key={l.ft} className="lb-label" style={{ top: `${y(l.ft)}%` }}>
            <b>{elev(l.ft, u)}</b> {l.label}
            <span className="lb-diff">{signed(elevVal(v.elevation! - l.ft, u), 1)} {u === "metric" ? "m" : "ft"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BigLake({ v, u, onOpen }: { v: ResView; u: Units; onOpen: (s: number) => void }) {
  return (
    <article className="biglake card" onClick={() => onOpen(v.cat.site)}>
      <header>
        <h3>{v.cat.name}</h3>
        <span className="muted">Presa {v.cat.dam} · {fdate(v.lastDate)}{v.stale && <b className="tag bad"> desactualizado</b>}</span>
      </header>
      <div className="bl-grid">
        <div>
          <div className="big">{pct(v.pct)}</div>
          <div className="muted">de su capacidad · {vol(v.storage, u)}</div>
          <dl className="kv">
            <dt>Hace un año</dt><dd>{pct(v.pctLastYear)}</dd>
            <dt>Cambio 30 días</dt><dd>{vol(v.ch30, u, true)}</dd>
            <dt>vs. mediana para la fecha</dt><dd>{vol(v.vsMedian, u, true)}{v.cls && <span className={`tag ${v.cls}`}>{CLS_LABEL[v.cls]}</span>}</dd>
            <dt>Entra (prom. 7 d){v.inflowEstimated ? " *" : ""}</dt><dd>{flow(v.inflow7, u)}</dd>
            <dt>Sale (prom. 7 d)</dt><dd>{flow(v.release7, u)}</dd>
            <dt>Cota hoy</dt><dd>{elev(v.elevation, u)}</dd>
            <dt>Cota 7 días</dt><dd>{elev(v.elevCh7, u, true)}</dd>
          </dl>
          {v.inflowEstimated && <p className="note">* Entrada estimada por balance (salida + cambio de almacenamiento), sin evaporación.</p>}
        </div>
        <LevelBar v={v} u={u} />
      </div>
    </article>
  );
}

type BTot = { storage: number; capacity: number; pct: number; lastYear: number | null; pctLastYear: number | null; count: number } | null;

export default function Overview({ views, tot, btot, gauges, u, onOpen }: { views: ResView[]; tot: SystemTotals; btot: BTot; gauges: GaugesState; u: Units; onOpen: (s: number) => void }) {
  const powell = views.find((v) => v.cat.site === 919);
  const mead = views.find((v) => v.cat.site === 921);
  const upper = views.filter((v) => v.cat.sub !== "baja" && v.net7 != null);
  const lees = gauges.gauges["09380000"]?.series;
  const nib = gauges.gauges["09522000"]?.series;
  const lastF = (s?: [number, number][]) => (s && s.length ? s[s.length - 1][1] : null);
  return (
    <>
      <section className="kpis">
        <div className="kpi hero">
          <span className="kpi-label">{btot ? `Toda la cuenca (${btot.count} embalses con dato vigente)` : `Embalses USBR (${tot.included.length} con dato vigente)`}</span>
          <span className="kpi-val">{pct((btot || tot).pct, 1)}</span>
          <span className="kpi-sub">{vol((btot || tot).storage, u)} de {vol((btot || tot).capacity, u)}</span>
          <div className="meter"><i style={{ width: `${Math.min(100, (btot || tot).pct * 100)}%` }} />{(btot || tot).pctLastYear != null && <b style={{ left: `${Math.min(100, (btot || tot).pctLastYear! * 100)}%` }} title="hace un año" />}</div>
          <span className="kpi-sub">Hace un año: {pct((btot || tot).pctLastYear, 1)}{(btot || tot).lastYear != null && ` · ${vol((btot || tot).storage - (btot || tot).lastYear!, u, true)}`}</span>
          {powell?.storage != null && mead?.storage != null && powell.refMax && mead.refMax && !powell.stale && !mead.stale && (
            <span className="kpi-sub">Powell + Mead: <b>{pct((powell.storage + mead.storage) / (powell.refMax + mead.refMax), 1)}</b> · {vol(powell.storage + mead.storage, u)}</span>
          )}
        </div>
        <div className="kpi">
          <span className="kpi-label">Sale de Powell ahora (Lees Ferry)</span>
          <span className="kpi-val sm">{flow(lastF(lees), u)}</span>
          <span className="kpi-sub">USGS, tiempo real</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Cruza a México ahora (NIB)</span>
          <span className="kpi-val sm">{flow(lastF(nib), u)}</span>
          <span className="kpi-sub">USGS, tiempo real</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Embalses de la Cuenca Alta ganando agua</span>
          <span className="kpi-val sm">{upper.filter((v) => (v.net7 || 0) > 0).length} / {upper.length}</span>
          <span className="kpi-sub">entrada &gt; salida, promedio 7 días</span>
        </div>
      </section>
      {tot.missing.length > 0 && <p className="note warn">Sin dato vigente (no suman al total): {tot.missing.join(", ")}.</p>}
      <section className="two">
        {powell && <BigLake v={powell} u={u} onOpen={onOpen} />}
        {mead && <BigLake v={mead} u={u} onOpen={onOpen} />}
      </section>
      <section className="card">
        <h2>La cuenca de un vistazo</h2>
        <Schematic views={views} gauges={gauges} u={u} onOpen={onOpen} />
      </section>
    </>
  );
}
