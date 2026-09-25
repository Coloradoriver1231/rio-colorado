import type { Q, Stat } from "../lib/calc";

/** Marca de calidad de un valor. REAL no lleva marca (ver leyenda). */
export default function QTag({ q, s }: { q?: Q; s?: Stat }) {
  const k = s?.q ?? q;
  if (!k || k === "real") return null;
  const label = k === "estimado" ? "estimado" : k === "parcial" ? (s ? `parcial ${s.days}/${s.n} d` : "parcial") : "sin datos";
  const title = k === "estimado" ? "Calculado por balance (salida + cambio de almacenamiento)" : k === "parcial" ? "Faltan días en la ventana: se usan sólo los días con dato, sin extrapolar" : "No hay datos suficientes";
  return <span className={`q q-${k}`} title={title}>{label}</span>;
}

export function QLegend() {
  return (
    <p className="note qlegend">
      Sin marca = <b>real</b> (todos los días con dato publicado) · <span className="q q-parcial">parcial</span> faltan días (no se extrapola) ·{" "}
      <span className="q q-estimado">estimado</span> calculado por balance · <span className="q q-sin-datos">sin datos</span>
    </p>
  );
}
