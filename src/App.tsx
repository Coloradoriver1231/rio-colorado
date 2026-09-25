import { useEffect, useMemo, useState } from "react";
import catalog from "./data/catalog.json";
import { basinTotals, derive, linkBasin, systemTotals } from "./lib/calc";
import { ago, type Units } from "./lib/units";
import { RESERVOIRS, useData } from "./lib/useData";
import Detail from "./components/Detail";
import Flows from "./components/Flows";
import Overview from "./components/Overview";
import Reservoirs from "./components/Reservoirs";
import Rivers from "./components/Rivers";
import MapPanel from "./components/MapPanel";

const TABS = [
  { id: "resumen", label: "Panorama" },
  { id: "embalses", label: "Embalses" },
  { id: "balance", label: "Entradas y salidas" },
  { id: "rios", label: "Ríos" },
  { id: "mapa", label: "Mapa" },
  { id: "fuentes", label: "Fuentes" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function load<T extends string>(k: string, def: T, ok: readonly string[]): T {
  try { const v = localStorage.getItem(k); return v && ok.includes(v) ? (v as T) : def; } catch { return def; }
}
function save(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }

export default function App() {
  const { res, gauges, basin, loadedAt, reload } = useData();
  const [u, setU] = useState<Units>(() => load("units", "metric", ["metric", "us"]));
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1);
    return (TABS.some((t) => t.id === h) ? h : "resumen") as Tab;
  });
  const [open, setOpen] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  useEffect(() => { save("units", u); }, [u]);
  useEffect(() => { history.replaceState(null, "", `#${tab}`); }, [tab]);

  const link = useMemo(() => linkBasin(basin.list, RESERVOIRS), [basin.list]);
  const views = useMemo(
    () => RESERVOIRS.map((c) => derive(c, res[c.site]?.data ?? null, res[c.site]?.state ?? "loading", res[c.site]?.error, undefined, link.capBySite.get(c.site) ?? null)),
    [res, link],
  );
  const tot = useMemo(() => systemTotals(views), [views]);
  const btot = useMemo(() => (basin.state === "ok" ? basinTotals(tot, link.others) : null), [tot, link, basin.state]);
  const openView = open != null ? views.find((v) => v.cat.site === open) : null;
  const loading = views.some((v) => v.state === "loading") || gauges.state === "loading" || basin.state === "loading";

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden><path d="M3 20c4-3 7 3 11 0s7 3 11 0 4-1 4-1v6c-3 2-7-3-11 0s-7-3-11 0-4 1-4 1z" fill="currentColor" /><path d="M16 3c-4 6-7 9-7 12a7 7 0 0 0 14 0c0-3-3-6-7-12z" fill="currentColor" opacity=".35" /></svg>
          <div>
            <h1>Río Colorado</h1>
            <p>Monitor de la cuenca · EE.UU. y México</p>
          </div>
        </div>
        <div className="top-right">
          <div className="seg" role="group" aria-label="Unidades">
            <button className={u === "metric" ? "on" : ""} onClick={() => setU("metric")}>hm³ · m³/s · m</button>
            <button className={u === "us" ? "on" : ""} onClick={() => setU("us")}>af · cfs · ft</button>
          </div>
          <button className="refresh" onClick={reload} disabled={loading} title="Volver a cargar">
            {loading ? "Cargando…" : `Actualizado ${ago(loadedAt)}`}
          </button>
        </div>
      </header>
      <nav className="tabs">
        {TABS.map((t) => <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </nav>
      <main>
        {tab === "resumen" && <Overview views={views} tot={tot} btot={btot} gauges={gauges} u={u} onOpen={setOpen} />}
        {tab === "embalses" && <Reservoirs views={views} others={link.others} basinState={basin.state} u={u} onOpen={setOpen} />}
        {tab === "balance" && <Flows views={views} u={u} onOpen={setOpen} />}
        {tab === "rios" && <Rivers gauges={gauges} u={u} />}
        {tab === "mapa" && <MapPanel views={views} others={link.others} coordBySite={link.coordBySite} hdbSites={basin.hdbSites} gauges={gauges} u={u} onOpen={setOpen} />}
        {tab === "fuentes" && <Sources />}
      </main>
      <footer>Datos provisorios de USBR, NRCS y USGS; pueden corregirse. No es un sistema oficial. Se actualiza solo cada 30 min.</footer>
      {openView && <Detail v={openView} u={u} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Sources() {
  const cap = (catalog as any).capacity_source;
  return (
    <section className="card prose">
      <h2>Fuentes y criterios</h2>
      <h3>De dónde salen los datos</h3>
      <ul>
        <li><b>Embalses</b> — Bureau of Reclamation (USBR), <a href="https://www.usbr.gov/uc/water/hydrodata/reservoir_data/site_map.html" target="_blank" rel="noreferrer">hydrodata</a>: almacenamiento, entrada media diaria, salida total media diaria y cota. Un dato por día, provisorio.</li>
        <li><b>Ríos</b> — USGS <a href="https://waterservices.usgs.gov/" target="_blank" rel="noreferrer">Water Services</a> (respaldo: <a href="https://api.waterdata.usgs.gov/" target="_blank" rel="noreferrer">API nueva de USGS</a>), caudal instantáneo (parámetro 00060), últimos 7 días. Se consulta cada 15 min; si USGS no responde se muestra el último dato bueno con su hora.</li>
        <li><b>Mapa</b> — ubicaciones de NRCS, USBR y USGS; mapa base © OpenStreetMap / CARTO.</li>
        <li><b>Capacidades</b> — la que publica USBR Lower Colorado para Powell, Mead, Mohave y Havasu (<a href={cap.url} target="_blank" rel="noreferrer">{cap.label}</a>) y algunas cargadas en el catálogo; para el resto, la <b>capacidad útil</b> que informa NRCS (USDA) en su base AWDB. Sólo se marca con * si no hay capacidad en ninguna de las dos fuentes (% sobre el máximo registrado).</li>
        <li><b>Resto de la cuenca</b> — NRCS <a href="https://wcc.sc.egov.usda.gov/awdbRestApi/" target="_blank" rel="noreferrer">AWDB</a>: todos los embalses de las cuencas HUC 14 (Alta) y 15 (Baja, incluye Salt, Verde, San Carlos) con su almacenamiento diario. Algunos (p. ej. los sistemas Salt y Verde) sólo tienen dato mensual: se muestran pero no suman al total.</li>
        <li><b>Niveles de referencia</b> de Powell (3.700 / 3.490 / 3.370 ft) y Mead (1.229 / 950 / 895 ft): lleno, mínimo para generar energía y nivel muerto, según USBR.</li>
      </ul>
      <h3>Cómo se calcula</h3>
      <ul>
        <li><b>% lleno</b> = almacenamiento / capacidad. Los informes de USBR pueden diferir 1–2 puntos según usen capacidad total o "viva" y la tabla cota-volumen vigente.</li>
        <li><b>Toda la cuenca</b> = suma de todos los embalses con capacidad conocida y dato diario de hace 4 días o menos. No es el mismo número que el "total system storage" de USBR (58,48 MAF, sólo embalses principales).</li>
        <li><b>Para la fecha</b>: el valor de hoy contra los percentiles 10, 50 y 90 del mismo día (±3 días) en todos los años anteriores con dato (mínimo 5). Muy bajo &lt; p10, Muy alto &gt; p90.</li>
        <li><b>Entrada estimada</b> (Mead, Mohave, Havasu): salida + cambio diario de almacenamiento, media de 7 días. No descuenta evaporación → subestima un poco.</li>
        <li><b>Dato viejo</b>: si el último dato de un embalse tiene más de 4 días, se marca y no suma al total del sistema. Un río con más de 24 h sin datos también se marca.</li>
        <li>Sin dato se muestra "—", nunca cero.</li>
      </ul>
      <h3>Conversiones</h3>
      <p>1 acre-foot = 1.233,5 m³ · 1 MAF = 1.233,5 hm³ · 1 cfs = 0,02832 m³/s · 1 pie = 0,3048 m.</p>
      <h3>Qué no incluye</h3>
      <ul>
        <li>Entrada y salida de los embalses que no son de USBR (Granby, Dillon, Salt, Verde…): NRCS sólo publica almacenamiento.</li>
        <li>Embalses del lado mexicano.</li>
        <li>Pronóstico de escurrimiento (CBRFC) y nieve (SNOTEL): no incluidos todavía.</li>
      </ul>
    </section>
  );
}
