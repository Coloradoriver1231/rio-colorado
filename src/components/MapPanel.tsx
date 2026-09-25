import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import catalog from "../data/catalog.json";
import type { BasinRes, ResView } from "../lib/calc";
import type { GaugesState } from "../lib/useData";
import type { SnowStatus } from "../../netlify/lib/snow";
import { ago, flow, pct, vol, type Units } from "../lib/units";

interface G { id: string; name: string; role?: string; lat: number; lon: number }

type Pin = {
  key: string; name: string; lat: number; lon: number; cap: number | null; pct: number | null; storage: number | null;
  date: string | null; site?: number; inflow?: number | null; release?: number | null; est?: boolean; sub: string; monthly?: boolean;
};

/** Colores por % lleno (mismas clases que la leyenda). */
function color(p: number | null) {
  if (p == null) return "#8d96a3";
  if (p < 0.25) return "#b23a2e";
  if (p < 0.5) return "#d18a2c";
  if (p < 0.75) return "#5aa9e0";
  return "#1f6fa8";
}
/** Nieve vs. mediana: escala divergente marrón (poca) → blanco (normal) → azul (mucha). Clasificación estadística, no alerta. */
function snowColor(p: number | null) {
  if (p == null) return "#c9cdd3";
  if (p < 0.7) return "#a6611a";
  if (p < 0.9) return "#dfc27d";
  if (p <= 1.1) return "#f5f5f5";
  if (p <= 1.3) return "#80cdc1";
  return "#018571";
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const radius = (cap: number | null) => (cap ? Math.max(4, Math.min(22, 3 + 3.2 * Math.log10(cap / 1000))) : 4);

const BOUNDS: L.LatLngBoundsExpression = [[31.6, -116.2], [43.4, -104.6]];

/** Leaflet calcula mal el tamaño si el contenedor no estaba medido al crearse: se corrige al montar y al redimensionar. */
function FitOnMount() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const t = setTimeout(() => { map.invalidateSize(); map.fitBounds(BOUNDS); map.fire("moveend"); }, 0);
    const ro = new ResizeObserver(() => { map.invalidateSize(); map.fire("moveend"); });
    ro.observe(el);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [map]);
  return null;
}

function ZoomWatch({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => onZoom(map.getZoom()), [map, onZoom]);
  return null;
}


export default function MapPanel({ views, others, coordBySite, hdbSites, gauges, snow, u, onOpen }: {
  views: ResView[]; others: BasinRes[]; coordBySite: Map<number, [number, number]>; hdbSites: { site: number; lat: number; lon: number }[];
  gauges: GaugesState; snow: SnowStatus | null; u: Units; onOpen: (s: number) => void;
}) {
  const [showRes, setShowRes] = useState(true);
  const [showRiv, setShowRiv] = useState(true);
  const [showSnow, setShowSnow] = useState(false);
  const [labels, setLabels] = useState(true);
  const [zoom, setZoom] = useState(5);

  const { pins, noLoc } = useMemo(() => {
    const hdb = new Map(hdbSites.map((s) => [s.site, [s.lat, s.lon] as [number, number]]));
    const pins: Pin[] = [];
    const noLoc: string[] = [];
    for (const v of views) {
      const c = hdb.get(v.cat.site) || coordBySite.get(v.cat.site);
      if (!c) { noLoc.push(v.cat.name); continue; }
      pins.push({
        key: `u${v.cat.site}`, name: v.cat.name, lat: c[0], lon: c[1], cap: v.pctBasis === "capacity" ? v.refMax : null,
        pct: v.pctBasis === "capacity" && !v.stale ? v.pct : null, storage: v.storage, date: v.lastDate, site: v.cat.site,
        inflow: v.inflow7, release: v.release7, est: v.inflowEstimated, sub: `${v.cat.river} · ${v.cat.state}`,
      });
    }
    for (const b of others)
      pins.push({
        key: b.id, name: b.name, lat: b.lat, lon: b.lon, cap: b.capacity_af,
        pct: b.af != null && b.capacity_af ? b.af / b.capacity_af : null, storage: b.af, date: b.date,
        sub: `${b.subbasin} · ${b.state}`, monthly: b.freq === "mensual",
      });
    pins.sort((a, b) => (b.cap || 0) - (a.cap || 0)); // chicos arriba de los grandes
    return { pins, noLoc };
  }, [views, others, coordBySite, hdbSites]);

  const list = (catalog as any).gauges as G[];
  // con poco zoom sólo se rotulan las estaciones clave (salidas de presas, confluencias, frontera); al acercar, todas
  const gaugeIcon = (txt: string, stale: boolean, key: boolean) =>
    L.divIcon({ className: "gpin-wrap", html: `<div class="gpin${stale ? " old" : ""}"><i></i>${labels && (key || zoom >= 7) ? `<span>${esc(txt)}</span>` : ""}</div>`, iconSize: [0, 0] });

  return (
    <section className="card mapcard">
      <div className="toolbar">
        <h2>Mapa de la cuenca</h2>
        <div className="filters checks">
          <label><input type="checkbox" checked={showRes} onChange={(e) => setShowRes(e.target.checked)} /> Embalses</label>
          <label><input type="checkbox" checked={showRiv} onChange={(e) => setShowRiv(e.target.checked)} /> Ríos (USGS)</label>
          <label><input type="checkbox" checked={showSnow} onChange={(e) => setShowSnow(e.target.checked)} /> Nieve (SNOTEL)</label>
          <label><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Etiquetas</label>
        </div>
      </div>
      <div className="mapbox">
        <MapContainer bounds={BOUNDS} zoomSnap={0.25} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
          <FitOnMount />
          <ZoomWatch onZoom={setZoom} />
          <TileLayer
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            subdomains="abc"
            maxZoom={17}
            attribution='Datos &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · Estilo &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
          />
          {showRes && pins.map((p) => (
            <CircleMarker
              key={p.key}
              center={[p.lat, p.lon]}
              radius={radius(p.cap)}
              pathOptions={{ color: "#16202e", weight: 1, fillColor: color(p.pct), fillOpacity: 0.85 }}
              eventHandlers={p.site != null ? { click: () => onOpen(p.site!) } : undefined}
            >
              <Tooltip direction="top" offset={[0, -radius(p.cap)]}>
                <div className="mtip">
                  <b>{p.name}</b><span>{p.sub}</span>
                  <div>{pct(p.pct)} lleno · {vol(p.storage, u)}{p.cap ? ` de ${vol(p.cap, u)}` : ""}</div>
                  {p.inflow != null && <div>Entra {flow(p.inflow, u)}{p.est ? "*" : ""} · Sale {flow(p.release, u)} (7 d)</div>}
                  <div className="muted">{p.date ?? "sin dato"}{p.monthly ? " · dato mensual" : ""}{p.site != null ? " · tocá para ver detalle" : ""}</div>
                </div>
              </Tooltip>
            </CircleMarker>
          ))}
          {showRes && labels && pins.filter((p) => p.cap != null && p.cap >= 800000).map((p) => (
            <Marker
              key={`lbl-${p.key}`}
              position={[p.lat, p.lon]}
              interactive={false}
              keyboard={false}
              icon={L.divIcon({ className: "mlabel-wrap", html: `<span class="mlabel" style="margin-left:${radius(p.cap) + 3}px">${esc(p.name.replace(/ Reservoir$/, ""))} ${pct(p.pct)}</span>`, iconSize: [0, 0] })}
            />
          ))}
          {showSnow && snow?.stations.map((s) => {
            const p = s.swe != null && s.sweMed != null && s.sweMed >= 1 ? s.swe / s.sweMed : null;
            const mm = (x: number | null) => (x == null ? "—" : u === "metric" ? `${Math.round(x * 25.4)} mm` : `${x.toFixed(1)} in`);
            return (
              <CircleMarker key={s.id} center={[s.lat, s.lon]} radius={4} pathOptions={{ color: "#16202e", weight: 0.6, fillColor: snowColor(p), fillOpacity: 0.9 }}>
                <Tooltip direction="top">
                  <div className="mtip">
                    <b>{s.name}</b><span>SNOTEL · {s.elev != null ? `${Math.round(u === "metric" ? s.elev * 0.3048 : s.elev)} ${u === "metric" ? "m" : "ft"}` : ""} · {s.subbasin}</span>
                    <div>SWE {mm(s.swe)} · mediana {mm(s.sweMed)}{p != null ? ` · ${Math.round(p * 100)} %` : ""}</div>
                    <div>Precip. año {mm(s.prec)}{s.prec != null && s.precMed ? ` (${Math.round((s.prec / s.precMed) * 100)} % de la mediana)` : ""} · 7 d {mm(s.p7)}</div>
                    <div className="muted">{s.date}</div>
                  </div>
                </Tooltip>
              </CircleMarker>
            );
          })}
          {showRiv && list.map((g) => {
            const s = gauges.gauges[g.id]?.series || [];
            const last = s.length ? s[s.length - 1] : null;
            const stale = !last || Date.now() - last[0] > 24 * 3600e3;
            return (
              <Marker key={g.id} position={[g.lat, g.lon]} icon={gaugeIcon(last ? flow(last[1], u) : "—", stale, !!g.role)}>
                <Tooltip direction="top" offset={[0, -8]}>
                  <div className="mtip">
                    <b>{g.name}</b>{g.role && <span>{g.role}</span>}
                    <div>{last ? `${flow(last[1], u)} · ${ago(last[0])}` : gauges.state === "loading" ? "cargando…" : "sin datos recientes"}</div>
                    <div className="muted">USGS {g.id}</div>
                  </div>
                </Tooltip>
              </Marker>
            );
          })}
        </MapContainer>
      </div>
      <div className="legend">
        <span><i style={{ background: color(0.1) }} /> &lt; 25 %</span>
        <span><i style={{ background: color(0.3) }} /> 25–50 %</span>
        <span><i style={{ background: color(0.6) }} /> 50–75 %</span>
        <span><i style={{ background: color(0.9) }} /> &gt; 75 %</span>
        <span><i style={{ background: color(null) }} /> sin dato</span>
        <span><b className="gsq" /> estación de aforo (caudal actual)</span>
        {showSnow && <span className="snowleg">SNOTEL, SWE vs. mediana: <i style={{ background: snowColor(0.5) }} />&lt;70 % <i style={{ background: snowColor(0.8) }} />70–90 <i style={{ background: snowColor(1) }} />90–110 <i style={{ background: snowColor(1.2) }} />110–130 <i style={{ background: snowColor(1.5) }} />&gt;130 % <i style={{ background: snowColor(null) }} />sin nieve para comparar</span>}
      </div>
      <p className="note">
        Tamaño del círculo ∝ capacidad del embalse. {pins.length} embalses en el mapa{noLoc.length ? ` (${noLoc.length} sin ubicación publicada: ${noLoc.join(", ")})` : ""}.
        Ubicaciones: NRCS, USBR y USGS. Mapa base: OpenTopoMap (© OpenStreetMap, SRTM).
      </p>
    </section>
  );
}
