import { useEffect, useMemo, useState } from "react";
import catalog from "./data/catalog.json";
import { basinTotals, derive, linkBasin, systemTotals } from "./lib/calc";
import { ago, type Units } from "./lib/units";
import { RESERVOIRS, useData, useSnow } from "./lib/useData";
import Snow from "./components/Snow";
import Boundary from "./components/Boundary";
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
  { id: "nieve", label: "Nieve y lluvia" },
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
  const snow = useSnow();
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
        <Boundary name={tab}>
        {tab === "resumen" && <Overview views={views} tot={tot} btot={btot} gauges={gauges} u={u} onOpen={setOpen} />}
        {tab === "embalses" && <Reservoirs views={views} others={link.others} basinState={basin.state} u={u} onOpen={setOpen} />}
        {tab === "balance" && <Flows views={views} u={u} onOpen={setOpen} />}
        {tab === "rios" && <Rivers gauges={gauges} u={u} />}
        {tab === "nieve" && <Snow snow={snow} u={u} />}
        {tab === "mapa" && <MapPanel views={views} others={link.others} coordBySite={link.coordBySite} hdbSites={basin.hdbSites} gauges={gauges} snow={snow.status} u={u} onOpen={setOpen} />}
        {tab === "fuentes" && <Sources />}
        </Boundary>
      </main>
      <footer>Datos provisorios de USBR, NRCS y USGS; pueden corregirse. No es un sistema oficial. Se actualiza solo cada 30 min.<br /><span className="ver">Versión v9 · 25-sep-2026</span></footer>
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
        <li><b>Embalses USBR</b> — Bureau of Reclamation, <a href="https://www.usbr.gov/uc/water/hydrodata/reservoir_data/site_map.html" target="_blank" rel="noreferrer">hydrodata</a>: almacenamiento, entrada y salida (caudal medio diario) y cota. Un dato por día, provisorio.</li>
        <li><b>Resto de los embalses y capacidades</b> — NRCS <a href="https://wcc.sc.egov.usda.gov/awdbRestApi/" target="_blank" rel="noreferrer">AWDB</a> (USDA): todos los embalses de las cuencas HUC 14 (Alta) y 15 (Baja) con su almacenamiento y capacidad útil. Powell, Mead, Mohave y Havasu usan la capacidad de <a href={cap.url} target="_blank" rel="noreferrer">USBR Lower Colorado</a>. Algunos (sistemas Salt y Verde) sólo tienen dato mensual: se muestran, no suman al total.</li>
        <li><b>Ríos</b> — USGS, <a href="https://api.waterdata.usgs.gov/" target="_blank" rel="noreferrer">Water Data APIs</a> (colección "continuous", parámetro 00060, pies³/s), últimos 7 días. El servicio viejo (waterservices) sólo se usa como respaldo hasta su baja, el 22-feb-2027. Se consulta cada 15 min; si USGS no responde se muestra el último dato bueno con su hora.</li>
        <li><b>Nieve y precipitación</b> — NRCS SNOTEL (AWDB): SWE, precipitación acumulada del año hidrológico y altura de nieve, con mediana y promedio 1991–2020 de cada día. Pronóstico oficial abril–julio de Lake Powell: NRCS/CBRFC. Aporte observado: USBR (entrada no regulada a Powell).</li>
        <li><b>Mapa</b> — ubicaciones de NRCS, USBR y USGS; mapa base OpenTopoMap (© OpenStreetMap, SRTM).</li>
        <li><b>Niveles de referencia</b> de Powell (3.700 lleno / 3.525 protección / 3.490 mínimo de generación / 3.370 nivel muerto) y Mead (1.229 lleno / 1.075-1.050-1.025 umbrales de escasez de las Guías 2007 / 950 mínimo de generación / 895 nivel muerto), en pies, según USBR. Son referencias oficiales, no alertas.</li>
      </ul>
      <h3>Cómo se calcula</h3>
      <ul>
        <li><b>% lleno</b> = almacenamiento / capacidad. Los informes de USBR pueden diferir 1–2 puntos según usen capacidad total o útil.</li>
        <li><b>Toda la cuenca</b> = suma de los embalses con capacidad conocida y dato diario de hace 4 días o menos. No es igual al "total system storage" de USBR (58,48 MAF, sólo embalses principales).</li>
        <li><b>Entra / Sale 7 d</b> = promedio simple de los 7 caudales medios DIARIOS publicados (no de lecturas horarias). En ríos, "prom. 7 d" es el promedio de las lecturas horarias de USGS (se indica cuántas horas hay).</li>
        <li><b>Volumen 30 d</b> = suma de los caudales medios diarios × 1,9835 (acre-feet por cfs·día). No se extrapola: si faltan días se marca <i>parcial</i> y con menos del 80 % de los días no se calcula. El <b>balance</b> usa sólo días con entrada y salida.</li>
        <li><b>Entrada estimada</b> (Mead, Mohave, Havasu: USBR no la publica) = salida + cambio diario de almacenamiento. No descuenta evaporación (subestima un poco) y puede dar días negativos: no se recortan; se marca <i>estimado</i>.</li>
        <li><b>Vs. historia</b>: el valor de hoy contra los percentiles 10/50/90 del mismo día (±3 días) en los años anteriores con dato (mínimo 5). Es una clasificación estadística propia, no una alerta oficial.</li>
        <li><b>Dato viejo</b>: embalse con más de 4 días sin dato, río con más de 24 h: se marca y no suma a los totales. Sin dato se muestra "—", nunca cero.</li>
      </ul>
      <h3>Conversiones</h3>
      <p>1 acre-foot = 1.233,48 m³ · 1 MAF = 1.233,5 hm³ · 1 cfs = 0,028317 m³/s · 1 cfs durante 1 día = 1,98347 acre-feet · 1 pie = 0,3048 m · 1 pulgada = 25,4 mm.</p>
      <h3>Qué no incluye</h3>
      <ul>
        <li>Entrada y salida de los embalses que no son de USBR (NRCS sólo publica almacenamiento).</li>
        <li>Embalses del lado mexicano. Temperatura y humedad del suelo en la estimación del monitor (sí en el pronóstico oficial).</li>
      </ul>
    </section>
  );
}
