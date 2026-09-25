import { useCallback, useEffect, useRef, useState } from "react";
import catalog from "../data/catalog.json";
import type { GaugeOut } from "../shared/process";
import type { BasinRes, ReservoirCat, UsbrResponse } from "./calc";

export const RESERVOIRS = (catalog as any).reservoirs as ReservoirCat[];

export interface ResState {
  state: "loading" | "ok" | "error" | "nodata";
  data: UsbrResponse | null;
  error?: string;
}

export interface GaugesState {
  state: "loading" | "ok" | "error";
  fetchedAt?: string;
  gauges: Record<string, GaugeOut>;
  error?: string;
}

async function getJson(url: string, tries = 2): Promise<{ status: number; body: any }> {
  let last: any;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      const body = await r.json().catch(() => null);
      if (r.status >= 500 && i < tries - 1) { await new Promise((ok) => setTimeout(ok, 1500)); continue; }
      return { status: r.status, body };
    } catch (e) {
      last = e;
      await new Promise((ok) => setTimeout(ok, 1500));
    }
  }
  throw last || new Error("sin conexión");
}

/** Bucket horario en la URL: el navegador no reutiliza respuestas viejas y el CDN comparte la de la hora. */
const hourBucket = () => Math.floor(Date.now() / 3600000);

export function useData() {
  const [res, setRes] = useState<Record<number, ResState>>(() =>
    Object.fromEntries(RESERVOIRS.map((r) => [r.site, { state: "loading", data: null }])),
  );
  const [gauges, setGauges] = useState<GaugesState>({ state: "loading", gauges: {} });
  const [basin, setBasin] = useState<{ state: "loading" | "ok" | "error"; list: BasinRes[]; error?: string }>({ state: "loading", list: [] });
  const [loadedAt, setLoadedAt] = useState<number>(Date.now());
  const running = useRef(false);

  const load = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    const b = hourBucket();
    const usgs = getJson(`/api/usgs?b=${Math.floor(Date.now() / 900000)}`)
      .then(({ status, body }) => {
        if (status === 200 && body?.gauges) setGauges({ state: "ok", gauges: body.gauges, fetchedAt: body.fetchedAt });
        else setGauges((g) => ({ ...g, state: Object.keys(g.gauges).length ? "ok" : "error", error: body?.error || `HTTP ${status}` }));
      })
      .catch((e) => setGauges((g) => ({ ...g, state: Object.keys(g.gauges).length ? "ok" : "error", error: String(e?.message || e) })));

    const nrcs = getJson(`/api/basin?b=${b}`)
      .then(({ status, body }) => {
        if (status === 200 && Array.isArray(body?.reservoirs)) setBasin({ state: "ok", list: body.reservoirs });
        else setBasin((x) => ({ ...x, state: x.list.length ? "ok" : "error", error: body?.error || `HTTP ${status}` }));
      })
      .catch((e) => setBasin((x) => ({ ...x, state: x.list.length ? "ok" : "error", error: String(e?.message || e) })));

    // embalses principales primero; 6 pedidos en paralelo
    const queue = [...RESERVOIRS].sort((a, b2) => Number(!!b2.major) - Number(!!a.major));
    const worker = async () => {
      for (let r = queue.shift(); r; r = queue.shift()) {
        const site = r.site;
        try {
          const { status, body } = await getJson(`/api/usbr/${site}?b=${b}`);
          setRes((p) => ({
            ...p,
            [site]:
              status === 200 ? { state: "ok", data: body }
              : status === 404 ? { state: "nodata", data: null, error: "USBR no publica datos de este embalse" }
              : p[site]?.data ? { ...p[site], state: "ok" } // se conserva el dato anterior
              : { state: "error", data: null, error: body?.error || `HTTP ${status}` },
          }));
        } catch (e: any) {
          setRes((p) => ({ ...p, [site]: p[site]?.data ? { ...p[site], state: "ok" } : { state: "error", data: null, error: String(e?.message || e) } }));
        }
      }
    };
    await Promise.all([usgs, nrcs, ...Array.from({ length: 6 }, worker)]);
    setLoadedAt(Date.now());
    running.current = false;
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  return { res, gauges, basin, loadedAt, reload: load };
}
