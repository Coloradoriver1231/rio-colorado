import { useState } from "react";

/** Proyección oficial de USBR (24-Month Study): gráficos publicados por USBR + informes. No se procesan: se muestran tal cual. */
function Img({ src, alt, page }: { src: string; alt: string; page: string }) {
  const [bad, setBad] = useState(false);
  return bad ? <p className="note warn">La imagen de USBR no cargó. Vela en la <a href={page} target="_blank" rel="noreferrer">página de proyecciones de USBR</a>.</p> : <img src={src} alt={alt} loading="lazy" onError={() => setBad(true)} />;
}

export default function Projections() {
  const base = "https://www.usbr.gov/lc/region/g4000";
  return (
    <section className="card">
      <div className="toolbar"><h2>Hacia dónde van Powell y Mead — proyección oficial de USBR</h2><span className="kind kind-oficial">🔵 PROYECCIÓN OFICIAL</span></div>
      <p className="muted">
        El <b>24-Month Study</b> es el estudio mensual con el que USBR proyecta las cotas de fin de mes de los embalses para los próximos 24 meses, con escenarios de aporte mínimo probable, más probable y máximo probable.
        Es la base para fijar las liberaciones de Glen Canyon y las condiciones de escasez de la Cuenca Baja. Los gráficos son los que publica USBR; la fecha del estudio figura en cada imagen.
      </p>
      <div className="proj">
        <figure>
          <Img src={`${base}/riverops/webreports/Powell24MS.png`} alt="Proyección oficial de USBR de la cota de fin de mes de Lake Powell (24-Month Study)" page={`${base}/riverops/24ms-projections.html`} />
          <figcaption>Lake Powell — cota de fin de mes proyectada (pies)</figcaption>
        </figure>
        <figure>
          <Img src={`${base}/riverops/webreports/Mead24MS.png`} alt="Proyección oficial de USBR de la cota de fin de mes de Lake Mead (24-Month Study)" page={`${base}/riverops/24ms-projections.html`} />
          <figcaption>Lake Mead — cota de fin de mes proyectada (pies)</figcaption>
        </figure>
      </div>
      <p className="note">
        Informes completos (PDF, USBR): <a href={`${base}/24mo_7.pdf`} target="_blank" rel="noreferrer">más probable (liberación de Powell 7 MAF)</a> ·{" "}
        <a href={`${base}/24mo_6.pdf`} target="_blank" rel="noreferrer">más probable (6 MAF)</a> · <a href={`${base}/24mo_MIN.pdf`} target="_blank" rel="noreferrer">mínimo probable</a> ·{" "}
        <a href={`${base}/24mo_MAX.pdf`} target="_blank" rel="noreferrer">máximo probable</a> · <a href={`${base}/riverops/24ms-projections.html`} target="_blank" rel="noreferrer">página de proyecciones</a>.
        USBR no publica estos resultados en un formato de datos abierto, por eso el monitor no los recalcula ni los mezcla con sus cálculos. Pies → metros: × 0,3048.
      </p>
    </section>
  );
}
