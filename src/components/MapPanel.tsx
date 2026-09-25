import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import catalog from "../data/catalog.json";
import type { BasinRes, ResView } from "../lib/calc";
import type { GaugesState } from "../lib/useData";
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

function useDark() {
  const q = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const [dark, setDark] = useState(() => !!q?.matches);
  useEffect(() => {
    if (!q) return;
    const f = () => setDark(q.matches);
    q.addEventListener("change", f);
    return () => q.removeEventListener("change", f);
  }, [q]);
  return dark;
}

export default function MapPanel({ views, others, coordBySite, hdbSites, gauges, u, onOpen }: {
  views: ResView[]; others: BasinRes[]; coordBySite: Map<number, [number, number]>; hdbSites: { site: number; lat: number; lon: number }[];
  gauges: GaugesState; u: Units; onOpen: (s: number) => void;
}) {
  const dark = useDark();
  const [showRes, setShowRes] = useState(true);
  const [showRiv, setShowRiv] = useState(true);
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
          <label><input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Etiquetas</label>
        </div>
      </div>
      <div className="mapbox">
        <MapContainer bounds={BOUNDS} zoomSnap={0.25} scrollWheelZoom style={{ height: "100%", width: "100%" }}>
          <FitOnMount />
          <ZoomWatch onZoom={setZoom} />
          <TileLayer
            key={dark ? "d" : "l"}
            url={dark ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"}
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
            subdomains="abcd"
          />
          {showRes && pins.map((p) => (
            <CircleMarker
              key={p.key}
              center={[p.lat, p.lon]}
              radius={radius(p.cap)}
              pathOptions={{ color: dark ? "#e6e9ee" : "#16202e", weight: 1, fillColor: color(p.pct), fillOpacity: 0.85 }}
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
      </div>
      <p className="note">
        Tamaño del círculo ∝ capacidad del embalse. {pins.length} embalses en el mapa{noLoc.length ? ` (${noLoc.length} sin ubicación publicada: ${noLoc.join(", ")})` : ""}.
        Ubicaciones: NRCS, USBR y USGS. Mapa base © OpenStreetMap, © CARTO.
      </p>
    </section>
  );
}
