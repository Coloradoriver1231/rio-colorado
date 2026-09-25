import type { ResView } from "../lib/calc";
import type { GaugesState } from "../lib/useData";
import { flow, pct, vol, type Units } from "../lib/units";

/**
 * Esquema de la cuenca (no es un mapa a escala): cada embalse es una "taza" de tamaño proporcional
 * a su capacidad, llena según el % actual. Sobre los ríos, el caudal actual de estaciones USGS clave.
 */
const POS: Record<number, [number, number]> = {
  916: [150, 80], // Fontenelle
  917: [150, 205], // Flaming Gorge
  912: [930, 285], // Taylor Park
  913: [840, 335], // Blue Mesa
  914: [745, 285], // Morrow Point
  915: [665, 335], // Crystal
  920: [830, 470], // Navajo
  919: [450, 540], // Powell
  921: [160, 600], // Mead
  922: [160, 730], // Mohave
  923: [160, 815], // Havasu
};

const RIVERS: { d: string; w: number }[] = [
  { d: "M150 30 L150 80 L150 205 L270 340 L380 430 L450 540", w: 4 }, // Green
  { d: "M900 80 L560 240 L380 430", w: 4 }, // Colorado alto
  { d: "M975 285 L930 285 L840 335 L745 285 L665 335 L560 240", w: 3 }, // Gunnison
  { d: "M960 455 L830 470 L650 525 L450 540", w: 3 }, // San Juan
  { d: "M450 540 L395 605 L250 622 L160 600", w: 5 }, // Gran Cañón
  { d: "M40 500 L160 600", w: 2 }, // Virgin
  { d: "M160 600 L160 730 L160 815 L160 875", w: 5 }, // Bajo Colorado
];

const GAUGES: { id: string; x: number; y: number; label: string; anchor?: "start" | "end"; below?: boolean }[] = [
  { id: "09315000", x: 270, y: 340, label: "Green en Green River, UT", anchor: "start" },
  { id: "09180500", x: 480, y: 320, label: "Colorado en Cisco, UT", anchor: "start" },
  { id: "09152500", x: 612, y: 287, label: "Gunnison en Grand Junction", anchor: "end" },
  { id: "09379500", x: 650, y: 525, label: "San Juan en Bluff", anchor: "start" },
  { id: "09380000", x: 395, y: 605, label: "Lees Ferry (sale)", anchor: "end" },
  { id: "09404200", x: 250, y: 622, label: "Diamond Creek (entra a Mead)", anchor: "start", below: true },
  { id: "09415000", x: 40, y: 500, label: "Río Virgin", anchor: "start" },
  { id: "09522000", x: 160, y: 875, label: "NIB — cruza a México", anchor: "start" },
];

const MAXCAP = 26120000;

function Cup({ v, x, y, u, onOpen }: { v: ResView; x: number; y: number; u: Units; onOpen: (s: number) => void }) {
  const size = v.refMax || v.cat.capacity_af || 100000;
  const w = 34 + 96 * Math.sqrt(size / MAXCAP);
  const h = w * 0.72;
  const top = y - h / 2;
  const bottom = y + h / 2;
  const inset = w * 0.16;
  const path = `M${x - w / 2} ${top} L${x + w / 2} ${top} L${x + w / 2 - inset} ${bottom} L${x - w / 2 + inset} ${bottom} Z`;
  const p = v.pct != null ? Math.max(0, Math.min(1, v.pct)) : 0;
  const fillTop = bottom - h * p;
  const id = `clip-${v.cat.site}`;
  const lyY = v.pctLastYear != null ? bottom - h * Math.max(0, Math.min(1, v.pctLastYear)) : null;
  const dim = v.state !== "ok" || v.stale;
  return (
    <g className={`cup ${dim ? "dim" : ""}`} onClick={() => onOpen(v.cat.site)} role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onOpen(v.cat.site)}>
      <title>{`${v.cat.name}: ${pct(v.pct)}${v.pctBasis === "record" ? " del máximo registrado" : " de la capacidad"}`}</title>
      <clipPath id={id}><path d={path} /></clipPath>
      <path d={path} className="cup-bg" />
      {v.pct != null && <rect x={x - w / 2} y={fillTop} width={w} height={bottom - fillTop} clipPath={`url(#${id})`} className="cup-fill" />}
      {lyY != null && <line x1={x - w / 2 - 4} x2={x + w / 2 + 4} y1={lyY} y2={lyY} className="cup-ly" />}
      <path d={path} className="cup-line" />
      <text x={x} y={top - 8} className="cup-name" textAnchor="middle">{v.cat.name}</text>
      <text x={x} y={bottom + 16} className="cup-pct" textAnchor="middle">
        {v.state === "loading" ? "…" : v.pct != null ? `${pct(v.pct)}${v.pctBasis === "record" ? "*" : ""}` : "sin dato"}
      </text>
      {v.storage != null && w > 60 && <text x={x} y={bottom + 31} className="cup-vol" textAnchor="middle">{vol(v.storage, u)}</text>}
    </g>
  );
}

export default function Schematic({ views, gauges, u, onOpen }: { views: ResView[]; gauges: GaugesState; u: Units; onOpen: (s: number) => void }) {
  const byId = new Map(views.map((v) => [v.cat.site, v]));
  return (
    <figure className="schematic">
      <div className="scroll"><svg viewBox="0 0 1000 900" role="img" aria-label="Esquema de embalses de la cuenca del río Colorado">
        {RIVERS.map((r, i) => <path key={i} d={r.d} className="river" style={{ strokeWidth: r.w }} />)}
        <text x={150} y={22} className="region" textAnchor="middle">GREEN RIVER</text>
        <text x={905} y={70} className="region" textAnchor="end">COLORADO (nacientes, Rocky Mountains)</text>
        <text x={975} y={235} className="region" textAnchor="end">GUNNISON</text>
        <text x={960} y={430} className="region" textAnchor="end">SAN JUAN</text>
        <text x={300} y={690} className="region">GRAN CAÑÓN</text>
        <text x={980} y={860} className="divide-label" textAnchor="end">Todo lo que está aguas arriba de Lee Ferry es Cuenca Alta; aguas abajo, Cuenca Baja (Compact de 1922).</text>
        {GAUGES.map((g) => {
          const s = gauges.gauges[g.id]?.series;
          const last = s && s.length ? s[s.length - 1][1] : null;
          return (
            <g key={g.id} className="gauge">
              <circle cx={g.x} cy={g.y} r={4} />
              <text x={g.x + (g.anchor === "end" ? -8 : 8)} y={g.y + (g.below ? 18 : -2)} textAnchor={g.anchor} className="gauge-name">{g.label}</text>
              <text x={g.x + (g.anchor === "end" ? -8 : 8)} y={g.y + (g.below ? 33 : 13)} textAnchor={g.anchor} className="gauge-val">
                {gauges.state === "loading" ? "…" : flow(last, u)}
              </text>
            </g>
          );
        })}
        {Object.entries(POS).map(([site, [x, y]]) => {
          const v = byId.get(Number(site));
          return v ? <Cup key={site} v={v} x={x} y={y} u={u} onOpen={onOpen} /> : null;
        })}
      </svg></div>
      <figcaption>
        Esquema, no mapa a escala. Tamaño de cada taza ∝ capacidad; relleno = % actual; línea = mismo día del año pasado.
        * = % del máximo registrado (USBR no publica capacidad en la fuente usada). Tocá una taza para ver el detalle.
      </figcaption>
    </figure>
  );
}
